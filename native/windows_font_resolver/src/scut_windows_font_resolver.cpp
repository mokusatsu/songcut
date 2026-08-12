#include "scut_windows_font_resolver.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <dwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <limits>
#include <mutex>
#include <new>
#include <string>
#include <utility>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

constexpr std::uint32_t kMaxCodepoints = 1u << 24;
constexpr std::uint32_t kMaxPathCharacters = 1u << 16;

bool Succeeded(HRESULT hr) noexcept { return SUCCEEDED(hr); }

std::int32_t AsInt32(HRESULT hr) noexcept {
    return static_cast<std::int32_t>(static_cast<std::uint32_t>(hr));
}

bool ValidHeader(std::uint32_t abi, std::uint32_t size, std::size_t required) noexcept {
    return abi == SCUT_FONT_ABI_VERSION && size >= required;
}

struct ComApartmentScope {
    HRESULT result{S_OK};
    bool uninitialize{false};

    ComApartmentScope() noexcept {
        result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (result == S_OK || result == S_FALSE) {
            uninitialize = true;
        } else if (result == RPC_E_CHANGED_MODE) {
            // The caller's apartment is already established.  DirectWrite's
            // shared factory is free-threaded, so retain the existing mode.
            result = S_OK;
        }
    }

    ~ComApartmentScope() {
        if (uninitialize) {
            CoUninitialize();
        }
    }

    ComApartmentScope(const ComApartmentScope&) = delete;
    ComApartmentScope& operator=(const ComApartmentScope&) = delete;
};

struct NameInfo {
    std::uint32_t kind{0};
    std::wstring locale;
    std::wstring value;
};

struct CandidateInfo {
    std::uint64_t candidate_id{0};
    std::uint32_t generation{0};
    std::uint32_t family_index{0};
    std::uint32_t font_index{0};
    std::uint32_t weight{0};
    std::uint32_t style{0};
    std::uint32_t stretch{0};
    std::uint32_t simulations{0};
    std::vector<NameInfo> names;
};

struct CandidateRef {
    std::uint32_t family_index{0};
    std::uint32_t font_index{0};
};

struct FileInfo {
    std::uint32_t file_index{0};
    std::uint32_t local_loader_available{0};
    std::uint32_t key_size{0};
    std::int32_t loader_hresult{0};
    std::wstring path;
};

struct GlyphInfo {
    std::uint32_t codepoint{0};
    std::uint16_t glyph_index{0};
    std::uint16_t flags{0};
    std::int32_t hresult{0};
};

struct FaceInfo {
    std::uint64_t candidate_id{0};
    std::uint32_t generation{0};
    std::int32_t hresult{0};
    std::uint32_t status_flags{0};
    std::uint32_t face_index{0};
    std::uint32_t simulations{0};
    std::vector<FileInfo> files;
    std::vector<GlyphInfo> glyphs;
    std::wstring path;
    std::int32_t glyph_hresult{0};
};

struct BlobBuilder {
    std::vector<std::uint8_t> bytes;

    bool Append(const std::wstring& value, std::uint32_t* offset,
                std::uint32_t* length) {
        if (offset == nullptr || length == nullptr) {
            return false;
        }
        const std::size_t count = value.size();
        if (count > (std::numeric_limits<std::uint32_t>::max() / sizeof(wchar_t))) {
            return false;
        }
        const std::size_t byte_count = count * sizeof(wchar_t);
        if (bytes.size() > std::numeric_limits<std::uint32_t>::max() - byte_count) {
            return false;
        }
        *offset = static_cast<std::uint32_t>(bytes.size());
        *length = static_cast<std::uint32_t>(byte_count);
        if (byte_count != 0) {
            const auto* begin = reinterpret_cast<const std::uint8_t*>(value.data());
            bytes.insert(bytes.end(), begin, begin + byte_count);
        }
        return true;
    }
};

HRESULT OverflowError() noexcept {
    return HRESULT_FROM_WIN32(ERROR_ARITHMETIC_OVERFLOW);
}

HRESULT CollectLocalized(IDWriteLocalizedStrings* strings, std::uint32_t kind,
                         std::vector<NameInfo>* out) {
    if (strings == nullptr || out == nullptr) {
        return E_INVALIDARG;
    }
    const UINT32 count = strings->GetCount();
    for (UINT32 index = 0; index < count; ++index) {
        UINT32 locale_length = 0;
        HRESULT hr = strings->GetLocaleNameLength(index, &locale_length);
        if (FAILED(hr)) {
            return hr;
        }
        if (locale_length == std::numeric_limits<UINT32>::max()) {
            return OverflowError();
        }
        std::vector<wchar_t> locale(locale_length + 1, L'\0');
        hr = strings->GetLocaleName(index, locale.data(),
                                     static_cast<UINT32>(locale.size()));
        if (FAILED(hr)) {
            return hr;
        }
        UINT32 value_length = 0;
        hr = strings->GetStringLength(index, &value_length);
        if (FAILED(hr)) {
            return hr;
        }
        if (value_length == std::numeric_limits<UINT32>::max()) {
            return OverflowError();
        }
        std::vector<wchar_t> value(value_length + 1, L'\0');
        hr = strings->GetString(index, value.data(),
                                static_cast<UINT32>(value.size()));
        if (FAILED(hr)) {
            return hr;
        }
        out->push_back(NameInfo{kind, std::wstring(locale.data(), locale_length),
                                std::wstring(value.data(), value_length)});
    }
    return S_OK;
}

HRESULT CollectInformational(IDWriteFont* font, DWRITE_INFORMATIONAL_STRING_ID id,
                             std::uint32_t kind, std::vector<NameInfo>* out) {
    if (font == nullptr || out == nullptr) {
        return E_INVALIDARG;
    }
    ComPtr<IDWriteLocalizedStrings> strings;
    BOOL exists = FALSE;
    const HRESULT hr = font->GetInformationalStrings(id, &strings, &exists);
    if (hr == S_FALSE) {
        return S_OK;
    }
    if (FAILED(hr)) {
        return hr;
    }
    if (!exists) {
        return S_OK;
    }
    return CollectLocalized(strings.Get(), kind, out);
}

HRESULT BuildReferences(IDWriteFontCollection* collection,
                        std::vector<CandidateRef>* refs) {
    if (collection == nullptr || refs == nullptr) {
        return E_INVALIDARG;
    }
    refs->clear();
    const UINT32 family_count = collection->GetFontFamilyCount();
    for (UINT32 family_index = 0; family_index < family_count; ++family_index) {
        ComPtr<IDWriteFontFamily> family;
        HRESULT hr = collection->GetFontFamily(family_index, &family);
        if (FAILED(hr)) {
            return hr;
        }
        const UINT32 font_count = family->GetFontCount();
        if (refs->size() > std::numeric_limits<std::uint32_t>::max() - font_count) {
            return OverflowError();
        }
        for (UINT32 font_index = 0; font_index < font_count; ++font_index) {
            refs->push_back(CandidateRef{family_index, font_index});
        }
    }
    return S_OK;
}

class Resolver;

struct ErrorState {
    std::uint32_t category{SCUT_FONT_ERROR_NONE};
    std::int32_t status{SCUT_FONT_OK};
    std::int32_t hresult{S_OK};
    char detail[512]{};
    std::uint32_t detail_length{0};
};

class Resolver {
public:
    Resolver() = default;
    ~Resolver() = default;

    SCUT_FONT_STATUS Initialize() noexcept {
        ComApartmentScope apartment;
        if (FAILED(apartment.result)) {
            SetErrorUnlocked(SCUT_FONT_COM_INITIALIZATION_FAILED,
                             SCUT_FONT_ERROR_COM, apartment.result,
                             "CoInitializeEx failed");
            return SCUT_FONT_COM_INITIALIZATION_FAILED;
        }
        HRESULT hr = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED,
                                         __uuidof(IDWriteFactory),
                                         reinterpret_cast<IUnknown**>(factory_.GetAddressOf()));
        if (FAILED(hr)) {
            SetErrorUnlocked(SCUT_FONT_DIRECTWRITE_ERROR,
                             SCUT_FONT_ERROR_DIRECTWRITE, hr,
                             "DWriteCreateFactory failed");
            return SCUT_FONT_DIRECTWRITE_ERROR;
        }
        return RefreshUnlocked();
    }

    SCUT_FONT_STATUS RefreshUnlocked(std::uint32_t* out_generation = nullptr) noexcept {
        if (out_generation != nullptr) {
            *out_generation = 0;
        }
        if (!factory_) {
            SetErrorUnlocked(SCUT_FONT_DIRECTWRITE_ERROR,
                             SCUT_FONT_ERROR_DIRECTWRITE, E_FAIL,
                             "DirectWrite factory is unavailable");
            return SCUT_FONT_DIRECTWRITE_ERROR;
        }
        ComPtr<IDWriteFontCollection> next_collection;
        HRESULT hr = factory_->GetSystemFontCollection(&next_collection, TRUE);
        if (FAILED(hr)) {
            SetErrorUnlocked(SCUT_FONT_DIRECTWRITE_ERROR,
                             SCUT_FONT_ERROR_DIRECTWRITE, hr,
                             "GetSystemFontCollection failed");
            return SCUT_FONT_DIRECTWRITE_ERROR;
        }
        std::vector<CandidateRef> next_refs;
        try {
            hr = BuildReferences(next_collection.Get(), &next_refs);
        } catch (...) {
            hr = OverflowError();
        }
        if (FAILED(hr)) {
            SetErrorUnlocked(SCUT_FONT_DIRECTWRITE_ERROR,
                             SCUT_FONT_ERROR_DIRECTWRITE, hr,
                             "font collection enumeration failed");
            return SCUT_FONT_DIRECTWRITE_ERROR;
        }
        if (generation_ == std::numeric_limits<std::uint32_t>::max()) {
            generation_ = 1;
        } else {
            ++generation_;
            if (generation_ == 0) {
                generation_ = 1;
            }
        }
        collection_ = std::move(next_collection);
        refs_ = std::move(next_refs);
        if (out_generation != nullptr) {
            *out_generation = generation_;
        }
        ClearErrorUnlocked();
        return SCUT_FONT_OK;
    }

    SCUT_FONT_STATUS EnumerateUnlocked(
        const SCUT_FONT_ENUM_REQUEST* request,
        SCUT_FONT_CANDIDATE_RECORD* candidates, std::uint32_t candidate_capacity,
        SCUT_FONT_NAME_RECORD* names, std::uint32_t name_capacity,
        std::uint8_t* string_buffer, std::uint32_t string_capacity,
        std::uint32_t* out_candidate_count, std::uint32_t* out_name_count,
        std::uint32_t* out_string_bytes, std::uint32_t* out_generation) noexcept;

    SCUT_FONT_STATUS InspectFaceUnlocked(
        const SCUT_FONT_FACE_REQUEST* request, SCUT_FONT_FACE_RECORD* face,
        SCUT_FONT_FILE_RECORD* files, std::uint32_t file_capacity,
        SCUT_FONT_GLYPH_RECORD* glyphs, std::uint32_t glyph_capacity,
        std::uint8_t* string_buffer, std::uint32_t string_capacity,
        std::uint32_t* out_file_count, std::uint32_t* out_glyph_count,
        std::uint32_t* out_string_bytes) noexcept;

    void SetErrorUnlocked(SCUT_FONT_STATUS status, std::uint32_t category,
                          HRESULT hr, const char* detail) noexcept {
        error_.status = static_cast<std::int32_t>(status);
        error_.category = category;
        error_.hresult = AsInt32(hr);
        error_.detail_length = 0;
        error_.detail[0] = '\0';
        if (detail != nullptr) {
            const std::size_t max_copy = sizeof(error_.detail) - 1;
            const std::size_t length = std::min(std::strlen(detail), max_copy);
            if (length != 0) {
                std::memcpy(error_.detail, detail, length);
            }
            error_.detail[length] = '\0';
            error_.detail_length = static_cast<std::uint32_t>(length);
        }
    }

    void ClearErrorUnlocked() noexcept {
        error_ = ErrorState{};
    }

    HRESULT ResolveCandidateUnlocked(std::uint64_t candidate_id,
                                     std::uint32_t generation,
                                     ComPtr<IDWriteFont>* out_font) noexcept {
        if (out_font == nullptr) {
            return E_INVALIDARG;
        }
        out_font->Reset();
        const std::uint32_t encoded_generation =
            static_cast<std::uint32_t>(candidate_id >> 32);
        const std::uint32_t ordinal =
            static_cast<std::uint32_t>(candidate_id & 0xffffffffu);
        if (generation_ == 0 || encoded_generation != generation_ ||
            generation != generation_ || ordinal == 0 ||
            ordinal > refs_.size()) {
            return HRESULT_FROM_WIN32(ERROR_INVALID_STATE);
        }
        const CandidateRef& ref = refs_[ordinal - 1];
        ComPtr<IDWriteFontFamily> family;
        HRESULT hr = collection_->GetFontFamily(ref.family_index, &family);
        if (FAILED(hr)) {
            return hr;
        }
        return family->GetFont(ref.font_index, out_font->GetAddressOf());
    }

    std::uint32_t Generation() const noexcept { return generation_; }
    std::size_t CandidateCount() const noexcept { return refs_.size(); }
    IDWriteFontCollection* CollectionUnlocked() const noexcept {
        return collection_.Get();
    }
    const CandidateRef& ReferenceUnlocked(std::size_t index) const noexcept {
        return refs_[index];
    }
    const ErrorState& Error() const noexcept { return error_; }
    std::mutex& Mutex() noexcept { return mutex_; }

    bool EnterCall() noexcept {
        std::lock_guard<std::mutex> lock(lifetime_mutex_);
        if (destroying_) {
            return false;
        }
        ++active_calls_;
        return true;
    }

    void LeaveCall() noexcept {
        std::lock_guard<std::mutex> lock(lifetime_mutex_);
        if (active_calls_ != 0) {
            --active_calls_;
        }
        if (destroying_ && active_calls_ == 0) {
            lifetime_cv_.notify_all();
        }
    }

    void ShutdownAndDelete() noexcept {
        std::unique_lock<std::mutex> lock(lifetime_mutex_);
        destroying_ = true;
        lifetime_cv_.wait(lock, [this] { return active_calls_ == 0; });
        lock.unlock();
        delete this;
    }

private:
    ComPtr<IDWriteFactory> factory_;
    ComPtr<IDWriteFontCollection> collection_;
    std::vector<CandidateRef> refs_;
    std::uint32_t generation_{0};
    ErrorState error_;
    std::mutex mutex_;
    std::mutex lifetime_mutex_;
    std::condition_variable lifetime_cv_;
    std::uint32_t active_calls_{0};
    bool destroying_{false};
};

struct CallGuard {
    Resolver* resolver{nullptr};
    explicit CallGuard(Resolver* value) noexcept : resolver(value) {}
    ~CallGuard() {
        if (resolver != nullptr) {
            resolver->LeaveCall();
        }
    }
    CallGuard(const CallGuard&) = delete;
    CallGuard& operator=(const CallGuard&) = delete;
};

HRESULT BuildCandidateInfo(Resolver* resolver, std::vector<CandidateInfo>* out) {
    if (resolver == nullptr || out == nullptr) {
        return E_INVALIDARG;
    }
    out->clear();
    const std::uint32_t generation = resolver->Generation();
    const std::size_t candidate_count = resolver->CandidateCount();
    if (candidate_count > std::numeric_limits<std::uint32_t>::max()) {
        return OverflowError();
    }
    for (std::size_t ordinal_index = 0; ordinal_index < candidate_count;
         ++ordinal_index) {
        const std::uint32_t ordinal =
            static_cast<std::uint32_t>(ordinal_index + 1);
        // ResolveCandidate performs the generation and bounds validation.  It
        // is intentionally used for every item so enumeration and stage 2 use
        // exactly the same opaque-ID mapping.
        const std::uint64_t candidate_id =
            (static_cast<std::uint64_t>(generation) << 32) | ordinal;
        ComPtr<IDWriteFont> font;
        const HRESULT resolve_hr = resolver->ResolveCandidateUnlocked(
            candidate_id, generation, &font);
        if (FAILED(resolve_hr)) {
            return resolve_hr;
        }
        CandidateInfo info;
        info.candidate_id = candidate_id;
        info.generation = generation;
        const CandidateRef& ref = resolver->ReferenceUnlocked(ordinal_index);
        info.family_index = ref.family_index;
        info.font_index = ref.font_index;
        info.weight = static_cast<std::uint32_t>(font->GetWeight());
        info.style = static_cast<std::uint32_t>(font->GetStyle());
        info.stretch = static_cast<std::uint32_t>(font->GetStretch());
        info.simulations = static_cast<std::uint32_t>(font->GetSimulations());

        ComPtr<IDWriteFontFamily> family;
        HRESULT hr = resolver->CollectionUnlocked()->GetFontFamily(
            ref.family_index, &family);
        if (FAILED(hr)) {
            return hr;
        }
        ComPtr<IDWriteLocalizedStrings> family_names;
        hr = family->GetFamilyNames(&family_names);
        if (FAILED(hr)) {
            return hr;
        }
        hr = CollectLocalized(family_names.Get(), SCUT_FONT_NAME_FAMILY, &info.names);
        if (FAILED(hr)) {
            return hr;
        }
        ComPtr<IDWriteLocalizedStrings> face_names;
        hr = font->GetFaceNames(&face_names);
        if (FAILED(hr)) {
            return hr;
        }
        hr = CollectLocalized(face_names.Get(), SCUT_FONT_NAME_FACE, &info.names);
        if (FAILED(hr)) {
            return hr;
        }
        hr = CollectInformational(font.Get(), DWRITE_INFORMATIONAL_STRING_FULL_NAME,
                                  SCUT_FONT_NAME_FULL, &info.names);
        if (FAILED(hr)) {
            return hr;
        }
        hr = CollectInformational(font.Get(), DWRITE_INFORMATIONAL_STRING_POSTSCRIPT_NAME,
                                  SCUT_FONT_NAME_POSTSCRIPT, &info.names);
        if (FAILED(hr)) {
            return hr;
        }
        out->push_back(std::move(info));
    }
    return S_OK;
}

bool IsValidCodepoint(std::uint32_t codepoint) noexcept {
    return codepoint <= 0x10ffffu;
}

HRESULT ResolvePath(IDWriteFontFile* file, FileInfo* out) {
    if (file == nullptr || out == nullptr) {
        return E_INVALIDARG;
    }
    ComPtr<IDWriteFontFileLoader> loader;
    HRESULT hr = file->GetLoader(&loader);
    out->loader_hresult = AsInt32(hr);
    if (FAILED(hr)) {
        return hr;
    }
    if (!loader) {
        out->loader_hresult = AsInt32(E_POINTER);
        return E_POINTER;
    }
    ComPtr<IDWriteLocalFontFileLoader> local_loader;
    hr = loader.As(&local_loader);
    if (hr == E_NOINTERFACE) {
        out->loader_hresult = AsInt32(hr);
        out->local_loader_available = 0;
        return S_OK;
    }
    if (FAILED(hr)) {
        out->loader_hresult = AsInt32(hr);
        return hr;
    }
    out->local_loader_available = 1;
    const void* key = nullptr;
    UINT32 key_size = 0;
    hr = file->GetReferenceKey(&key, &key_size);
    out->key_size = key_size;
    if (FAILED(hr)) {
        out->loader_hresult = AsInt32(hr);
        return hr;
    }
    UINT32 path_length = 0;
    hr = local_loader->GetFilePathLengthFromKey(key, key_size, &path_length);
    out->loader_hresult = AsInt32(hr);
    if (FAILED(hr)) {
        return S_OK;
    }
    if (path_length > kMaxPathCharacters) {
        out->loader_hresult = AsInt32(HRESULT_FROM_WIN32(ERROR_BUFFER_OVERFLOW));
        return S_OK;
    }
    std::vector<wchar_t> path(path_length + 1, L'\0');
    hr = local_loader->GetFilePathFromKey(key, key_size, path.data(),
                                          static_cast<UINT32>(path.size()));
    out->loader_hresult = AsInt32(hr);
    if (FAILED(hr)) {
        return S_OK;  // raw per-file failure is returned to the caller
    }
    out->path.assign(path.data(), path_length);
    return S_OK;
}

HRESULT BuildFaceInfo(Resolver* resolver, const SCUT_FONT_FACE_REQUEST* request,
                      FaceInfo* out) {
    if (resolver == nullptr || request == nullptr || out == nullptr) {
        return E_INVALIDARG;
    }
    out->candidate_id = request->candidate_id;
    out->generation = request->generation;
    out->hresult = AsInt32(S_OK);
    out->glyph_hresult = AsInt32(S_OK);
    ComPtr<IDWriteFont> font;
    HRESULT hr = resolver->ResolveCandidateUnlocked(request->candidate_id,
                                                    request->generation, &font);
    if (FAILED(hr)) {
        out->hresult = AsInt32(hr);
        return hr;
    }
    ComPtr<IDWriteFontFace> face;
    hr = font->CreateFontFace(&face);
    if (FAILED(hr)) {
        out->hresult = AsInt32(hr);
        return hr;
    }
    if (!face) {
        out->hresult = AsInt32(E_POINTER);
        return E_POINTER;
    }
    out->status_flags |= SCUT_FONT_FACE_CREATED;
    out->face_index = face->GetIndex();
    out->simulations = static_cast<std::uint32_t>(face->GetSimulations());

    UINT32 file_count = 0;
    hr = face->GetFiles(&file_count, nullptr);
    if (FAILED(hr)) {
        out->hresult = AsInt32(hr);
        return hr;
    }
    if (file_count != 0) {
        std::vector<IDWriteFontFile*> raw_files(file_count, nullptr);
        UINT32 returned_count = file_count;
        hr = face->GetFiles(&returned_count, raw_files.data());
        if (FAILED(hr)) {
            out->hresult = AsInt32(hr);
            return hr;
        }
        file_count = returned_count;
        out->files.reserve(file_count);
        for (UINT32 i = 0; i < file_count; ++i) {
            ComPtr<IDWriteFontFile> file;
            file.Attach(raw_files[i]);
            FileInfo info;
            info.file_index = i;
            const HRESULT path_hr = ResolvePath(file.Get(), &info);
            if (FAILED(path_hr)) {
                info.loader_hresult = AsInt32(path_hr);
            }
            if (info.local_loader_available != 0) {
                out->status_flags |= SCUT_FONT_LOCAL_LOADER_AVAILABLE;
            }
            if (!info.path.empty()) {
                out->status_flags |= SCUT_FONT_PATH_RESOLVED;
                if (out->path.empty()) {
                    out->path = info.path;
                }
            }
            out->files.push_back(std::move(info));
        }
    }
    if (out->files.size() > 1) {
        out->status_flags |= SCUT_FONT_MULTIPLE_FILES;
    }

    const UINT32 count = request->codepoint_count;
    out->glyphs.resize(count);
    std::vector<UINT16> glyph_indices(count, 0);
    bool all_valid = true;
    for (UINT32 i = 0; i < count; ++i) {
        const std::uint32_t cp = request->codepoints[i];
        out->glyphs[i].codepoint = cp;
        if (!IsValidCodepoint(cp)) {
            all_valid = false;
            out->glyphs[i].hresult = AsInt32(E_INVALIDARG);
            out->glyphs[i].flags = 1u;
        }
    }
    if (count != 0 && all_valid) {
        hr = face->GetGlyphIndices(request->codepoints, count, glyph_indices.data());
        out->glyph_hresult = AsInt32(hr);
        if (FAILED(hr)) {
            out->status_flags |= SCUT_FONT_GLYPH_QUERY_FAILED;
        }
        for (UINT32 i = 0; i < count; ++i) {
            out->glyphs[i].glyph_index = SUCCEEDED(hr) ? glyph_indices[i] : 0;
            out->glyphs[i].hresult = AsInt32(hr);
        }
    } else if (count != 0) {
        out->glyph_hresult = AsInt32(E_INVALIDARG);
        out->status_flags |= SCUT_FONT_GLYPH_QUERY_FAILED;
        for (auto& glyph : out->glyphs) {
            if (glyph.hresult == 0) {
                glyph.hresult = AsInt32(E_INVALIDARG);
            }
        }
    }
    return S_OK;
}

SCUT_FONT_STATUS InvalidArg(Resolver* resolver, const char* detail) noexcept;

SCUT_FONT_STATUS Resolver::EnumerateUnlocked(
    const SCUT_FONT_ENUM_REQUEST* request,
    SCUT_FONT_CANDIDATE_RECORD* candidates, std::uint32_t candidate_capacity,
    SCUT_FONT_NAME_RECORD* names, std::uint32_t name_capacity,
    std::uint8_t* string_buffer, std::uint32_t string_capacity,
    std::uint32_t* out_candidate_count, std::uint32_t* out_name_count,
    std::uint32_t* out_string_bytes, std::uint32_t* out_generation) noexcept {
    if (request == nullptr || out_candidate_count == nullptr ||
        out_name_count == nullptr || out_string_bytes == nullptr ||
        out_generation == nullptr) {
        return InvalidArg(this, "enumerate output pointers are required");
    }
    if (!ValidHeader(request->abi_version, request->struct_size,
                     sizeof(SCUT_FONT_ENUM_REQUEST))) {
        SetErrorUnlocked(request->abi_version == SCUT_FONT_ABI_VERSION
                             ? SCUT_FONT_INVALID_ARGUMENT
                             : SCUT_FONT_ABI_MISMATCH,
                         request->abi_version == SCUT_FONT_ABI_VERSION
                             ? SCUT_FONT_ERROR_ARGUMENT
                             : SCUT_FONT_ERROR_ABI,
                         E_INVALIDARG, "enumerate ABI header is invalid");
        return request->abi_version == SCUT_FONT_ABI_VERSION
                   ? SCUT_FONT_INVALID_ARGUMENT
                   : SCUT_FONT_ABI_MISMATCH;
    }
    if (request->flags != 0 || request->reserved != 0) {
        return InvalidArg(this, "enumerate flags must be zero");
    }
    if ((candidate_capacity != 0 && candidates == nullptr) ||
        (name_capacity != 0 && names == nullptr) ||
        (string_capacity != 0 && string_buffer == nullptr)) {
        return InvalidArg(this, "enumerate buffer pointer is null");
    }

    std::vector<CandidateInfo> infos;
    try {
        const HRESULT hr = BuildCandidateInfo(this, &infos);
        if (FAILED(hr)) {
            SetErrorUnlocked(SCUT_FONT_DIRECTWRITE_ERROR,
                             SCUT_FONT_ERROR_DIRECTWRITE, hr,
                             "DirectWrite candidate metadata failed");
            return SCUT_FONT_DIRECTWRITE_ERROR;
        }
    } catch (const std::bad_alloc&) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_OUTOFMEMORY, "candidate metadata allocation failed");
        return SCUT_FONT_INTERNAL_ERROR;
    } catch (...) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_FAIL, "candidate metadata failed");
        return SCUT_FONT_INTERNAL_ERROR;
    }

    std::vector<SCUT_FONT_NAME_RECORD> name_records;
    BlobBuilder blob;
    try {
        std::size_t name_total = 0;
        for (const auto& info : infos) {
            if (name_total > std::numeric_limits<std::uint32_t>::max() -
                                info.names.size()) {
                SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                                 OverflowError(), "name count overflow");
                return SCUT_FONT_INTERNAL_ERROR;
            }
            name_total += info.names.size();
        }
        name_records.reserve(name_total);
        for (const auto& info : infos) {
            for (const auto& name : info.names) {
                SCUT_FONT_NAME_RECORD record{};
                record.abi_version = SCUT_FONT_ABI_VERSION;
                record.struct_size = sizeof(record);
                record.candidate_id = info.candidate_id;
                record.kind = name.kind;
                if (!blob.Append(name.locale, &record.locale_offset,
                                 &record.locale_length) ||
                    !blob.Append(name.value, &record.value_offset,
                                 &record.value_length)) {
                    SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR,
                                     SCUT_FONT_ERROR_INTERNAL, OverflowError(),
                                     "name string blob overflow");
                    return SCUT_FONT_INTERNAL_ERROR;
                }
                name_records.push_back(record);
            }
        }
    } catch (const std::bad_alloc&) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_OUTOFMEMORY, "name metadata allocation failed");
        return SCUT_FONT_INTERNAL_ERROR;
    } catch (...) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_FAIL, "name metadata failed");
        return SCUT_FONT_INTERNAL_ERROR;
    }

    const auto candidate_count = static_cast<std::uint32_t>(infos.size());
    const auto name_count = static_cast<std::uint32_t>(name_records.size());
    const auto string_bytes = static_cast<std::uint32_t>(blob.bytes.size());
    *out_candidate_count = candidate_count;
    *out_name_count = name_count;
    *out_string_bytes = string_bytes;
    *out_generation = generation_;
    if (candidate_capacity < candidate_count || name_capacity < name_count ||
        string_capacity < string_bytes) {
        SetErrorUnlocked(SCUT_FONT_BUFFER_TOO_SMALL, SCUT_FONT_ERROR_BUFFER,
                         HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER),
                         "enumerate output buffer is too small");
        return SCUT_FONT_BUFFER_TOO_SMALL;
    }
    if (candidate_count != 0 && candidates == nullptr) {
        return InvalidArg(this, "candidate output buffer is null");
    }
    if (name_count != 0 && names == nullptr) {
        return InvalidArg(this, "name output buffer is null");
    }
    if (string_bytes != 0 && string_buffer == nullptr) {
        return InvalidArg(this, "string output buffer is null");
    }

    std::uint32_t name_cursor = 0;
    for (std::size_t index = 0; index < infos.size(); ++index) {
        const auto& info = infos[index];
        auto& record = candidates[index];
        std::memset(&record, 0, sizeof(record));
        record.abi_version = SCUT_FONT_ABI_VERSION;
        record.struct_size = sizeof(record);
        record.candidate_id = info.candidate_id;
        record.generation = info.generation;
        record.family_index = info.family_index;
        record.font_index = info.font_index;
        record.weight = info.weight;
        record.style = info.style;
        record.stretch = info.stretch;
        record.simulations = info.simulations;
        record.first_name = name_cursor;
        record.name_count = static_cast<std::uint32_t>(info.names.size());
        name_cursor += record.name_count;
    }
    if (name_count != 0) {
        std::memcpy(names, name_records.data(),
                    name_records.size() * sizeof(SCUT_FONT_NAME_RECORD));
    }
    if (string_bytes != 0) {
        std::memcpy(string_buffer, blob.bytes.data(), string_bytes);
    }
    ClearErrorUnlocked();
    return SCUT_FONT_OK;
}

SCUT_FONT_STATUS Resolver::InspectFaceUnlocked(
    const SCUT_FONT_FACE_REQUEST* request, SCUT_FONT_FACE_RECORD* face,
    SCUT_FONT_FILE_RECORD* files, std::uint32_t file_capacity,
    SCUT_FONT_GLYPH_RECORD* glyphs, std::uint32_t glyph_capacity,
    std::uint8_t* string_buffer, std::uint32_t string_capacity,
    std::uint32_t* out_file_count, std::uint32_t* out_glyph_count,
    std::uint32_t* out_string_bytes) noexcept {
    if (request == nullptr || out_file_count == nullptr ||
        out_glyph_count == nullptr || out_string_bytes == nullptr) {
        return InvalidArg(this, "inspect output pointers are required");
    }
    if (!ValidHeader(request->abi_version, request->struct_size,
                     sizeof(SCUT_FONT_FACE_REQUEST))) {
        SetErrorUnlocked(request->abi_version == SCUT_FONT_ABI_VERSION
                             ? SCUT_FONT_INVALID_ARGUMENT
                             : SCUT_FONT_ABI_MISMATCH,
                         request->abi_version == SCUT_FONT_ABI_VERSION
                             ? SCUT_FONT_ERROR_ARGUMENT
                             : SCUT_FONT_ERROR_ABI,
                         E_INVALIDARG, "face ABI header is invalid");
        return request->abi_version == SCUT_FONT_ABI_VERSION
                   ? SCUT_FONT_INVALID_ARGUMENT
                   : SCUT_FONT_ABI_MISMATCH;
    }
    if (request->flags != 0 || request->reserved != 0) {
        return InvalidArg(this, "face flags must be zero");
    }
    if (request->codepoint_count > kMaxCodepoints ||
        (request->codepoint_count != 0 && request->codepoints == nullptr)) {
        return InvalidArg(this, "codepoint array is null or too large");
    }
    if ((file_capacity != 0 && files == nullptr) ||
        (glyph_capacity != 0 && glyphs == nullptr) ||
        (string_capacity != 0 && string_buffer == nullptr)) {
        return InvalidArg(this, "face output buffer pointer is null");
    }

    FaceInfo info;
    try {
        const HRESULT hr = BuildFaceInfo(this, request, &info);
        if (FAILED(hr)) {
            const SCUT_FONT_STATUS status =
                hr == HRESULT_FROM_WIN32(ERROR_INVALID_STATE)
                    ? SCUT_FONT_STALE_CANDIDATE
                    : SCUT_FONT_DIRECTWRITE_ERROR;
            SetErrorUnlocked(status,
                             status == SCUT_FONT_STALE_CANDIDATE
                                 ? SCUT_FONT_ERROR_CANDIDATE
                                 : SCUT_FONT_ERROR_DIRECTWRITE,
                             hr, status == SCUT_FONT_STALE_CANDIDATE
                                     ? "candidate ID is stale"
                                     : "DirectWrite face inspection failed");
            return status;
        }
    } catch (const std::bad_alloc&) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_OUTOFMEMORY, "face metadata allocation failed");
        return SCUT_FONT_INTERNAL_ERROR;
    } catch (...) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_FAIL, "face metadata failed");
        return SCUT_FONT_INTERNAL_ERROR;
    }

    BlobBuilder blob;
    std::vector<std::uint32_t> path_offsets;
    std::vector<std::uint32_t> path_lengths;
    try {
        path_offsets.resize(info.files.size(), 0);
        path_lengths.resize(info.files.size(), 0);
        for (std::size_t i = 0; i < info.files.size(); ++i) {
            if (!blob.Append(info.files[i].path, &path_offsets[i],
                             &path_lengths[i])) {
                SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR,
                                 SCUT_FONT_ERROR_INTERNAL, OverflowError(),
                                 "face path blob overflow");
                return SCUT_FONT_INTERNAL_ERROR;
            }
        }
        std::uint32_t ignored_offset = 0;
        std::uint32_t ignored_length = 0;
        if (!info.path.empty() &&
            !blob.Append(info.path, &ignored_offset, &ignored_length)) {
            SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR,
                             SCUT_FONT_ERROR_INTERNAL, OverflowError(),
                             "face path blob overflow");
            return SCUT_FONT_INTERNAL_ERROR;
        }
    } catch (const std::bad_alloc&) {
        SetErrorUnlocked(SCUT_FONT_INTERNAL_ERROR, SCUT_FONT_ERROR_INTERNAL,
                         E_OUTOFMEMORY, "face path allocation failed");
        return SCUT_FONT_INTERNAL_ERROR;
    }

    const auto file_count = static_cast<std::uint32_t>(info.files.size());
    const auto glyph_count = static_cast<std::uint32_t>(info.glyphs.size());
    const auto string_bytes = static_cast<std::uint32_t>(blob.bytes.size());
    *out_file_count = file_count;
    *out_glyph_count = glyph_count;
    *out_string_bytes = string_bytes;
    if (file_capacity < file_count || glyph_capacity < glyph_count ||
        string_capacity < string_bytes) {
        SetErrorUnlocked(SCUT_FONT_BUFFER_TOO_SMALL, SCUT_FONT_ERROR_BUFFER,
                         HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER),
                         "face output buffer is too small");
        return SCUT_FONT_BUFFER_TOO_SMALL;
    }
    if (face == nullptr) {
        return InvalidArg(this, "face output record is null");
    }
    if (file_count != 0 && files == nullptr) {
        return InvalidArg(this, "file output buffer is null");
    }
    if (glyph_count != 0 && glyphs == nullptr) {
        return InvalidArg(this, "glyph output buffer is null");
    }
    if (string_bytes != 0 && string_buffer == nullptr) {
        return InvalidArg(this, "face string output buffer is null");
    }

    std::memset(face, 0, sizeof(*face));
    face->abi_version = SCUT_FONT_ABI_VERSION;
    face->struct_size = sizeof(*face);
    face->candidate_id = info.candidate_id;
    face->generation = info.generation;
    face->hresult = info.hresult;
    face->status_flags = info.status_flags;
    face->face_index = info.face_index;
    face->simulations = info.simulations;
    face->file_count = file_count;
    face->local_file_count = 0;
    face->glyph_count = glyph_count;
    face->first_file = 0;
    face->first_glyph = 0;
    face->path_offset = 0;
    face->path_length = 0;
    face->glyph_hresult = info.glyph_hresult;
    for (std::size_t i = 0; i < info.files.size(); ++i) {
        auto& dst = files[i];
        std::memset(&dst, 0, sizeof(dst));
        dst.abi_version = SCUT_FONT_ABI_VERSION;
        dst.struct_size = sizeof(dst);
        dst.candidate_id = info.candidate_id;
        dst.file_index = info.files[i].file_index;
        dst.local_loader_available = info.files[i].local_loader_available;
        dst.key_size = info.files[i].key_size;
        dst.loader_hresult = info.files[i].loader_hresult;
        dst.path_offset = path_offsets[i];
        dst.path_length = path_lengths[i];
        if (dst.local_loader_available != 0) {
            ++face->local_file_count;
        }
    }
    for (std::size_t i = 0; i < info.glyphs.size(); ++i) {
        auto& dst = glyphs[i];
        std::memset(&dst, 0, sizeof(dst));
        dst.abi_version = SCUT_FONT_ABI_VERSION;
        dst.struct_size = sizeof(dst);
        dst.codepoint = info.glyphs[i].codepoint;
        dst.glyph_index = info.glyphs[i].glyph_index;
        dst.flags = info.glyphs[i].flags;
        dst.hresult = info.glyphs[i].hresult;
    }
    if (!info.path.empty()) {
        // The face-level path is duplicated at the end of the blob after all
        // per-file paths.  Recompute its offset deterministically without
        // mutating the already-sized blob.
        std::uint32_t offset = 0;
        for (const auto& file : info.files) {
            offset += static_cast<std::uint32_t>(file.path.size() * sizeof(wchar_t));
        }
        face->path_offset = offset;
        face->path_length = static_cast<std::uint32_t>(info.path.size() * sizeof(wchar_t));
    }
    if (*out_string_bytes != 0) {
        if (string_capacity < *out_string_bytes || string_buffer == nullptr) {
            return SCUT_FONT_BUFFER_TOO_SMALL;
        }
        std::memcpy(string_buffer, blob.bytes.data(), *out_string_bytes);
    }
    ClearErrorUnlocked();
    return SCUT_FONT_OK;
}

SCUT_FONT_STATUS InvalidArg(Resolver* resolver, const char* detail) noexcept {
    if (resolver != nullptr) {
        resolver->SetErrorUnlocked(SCUT_FONT_INVALID_ARGUMENT,
                                    SCUT_FONT_ERROR_ARGUMENT, E_INVALIDARG,
                                    detail);
    }
    return SCUT_FONT_INVALID_ARGUMENT;
}

}  // namespace

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_create(
    const SCUT_FONT_CREATE_REQUEST* request,
    SCUT_FONT_RESOLVER_HANDLE* out_handle) {
    if (out_handle == nullptr) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    *out_handle = nullptr;
    if (request == nullptr ||
        !ValidHeader(request->abi_version, request->struct_size,
                     sizeof(SCUT_FONT_CREATE_REQUEST))) {
        return request != nullptr && request->abi_version != SCUT_FONT_ABI_VERSION
                   ? SCUT_FONT_ABI_MISMATCH
                   : SCUT_FONT_INVALID_ARGUMENT;
    }
    if (request->flags != 0 || request->reserved != 0) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    try {
        auto* resolver = new Resolver();
        const SCUT_FONT_STATUS status = resolver->Initialize();
        if (status != SCUT_FONT_OK) {
            delete resolver;
            return status;
        }
        *out_handle = reinterpret_cast<SCUT_FONT_RESOLVER_HANDLE>(resolver);
        return SCUT_FONT_OK;
    } catch (...) {
        return SCUT_FONT_INTERNAL_ERROR;
    }
}

SCUT_FONT_API void SCUT_FONT_CALL scut_font_resolver_destroy(
    SCUT_FONT_RESOLVER_HANDLE handle) {
    if (handle == nullptr) {
        return;
    }
    try {
        auto* resolver = reinterpret_cast<Resolver*>(handle);
        ComApartmentScope apartment;
        resolver->ShutdownAndDelete();
    } catch (...) {
        // Destructors and locks are noexcept in normal operation.  The C ABI
        // deliberately swallows any exceptional runtime edge case.
    }
}

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_refresh(
    SCUT_FONT_RESOLVER_HANDLE handle, std::uint32_t* out_generation) {
    if (handle == nullptr || out_generation == nullptr) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    auto* resolver = reinterpret_cast<Resolver*>(handle);
    try {
        if (!resolver->EnterCall()) {
            return SCUT_FONT_STALE_CANDIDATE;
        }
        CallGuard call_guard(resolver);
        ComApartmentScope apartment;
        if (FAILED(apartment.result)) {
            std::lock_guard<std::mutex> lock(resolver->Mutex());
            resolver->SetErrorUnlocked(SCUT_FONT_COM_INITIALIZATION_FAILED,
                                       SCUT_FONT_ERROR_COM, apartment.result,
                                       "CoInitializeEx failed");
            return SCUT_FONT_COM_INITIALIZATION_FAILED;
        }
        std::lock_guard<std::mutex> lock(resolver->Mutex());
        return resolver->RefreshUnlocked(out_generation);
    } catch (...) {
        return SCUT_FONT_INTERNAL_ERROR;
    }
}

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_enumerate(
    SCUT_FONT_RESOLVER_HANDLE handle, const SCUT_FONT_ENUM_REQUEST* request,
    SCUT_FONT_CANDIDATE_RECORD* candidates, std::uint32_t candidate_capacity,
    SCUT_FONT_NAME_RECORD* names, std::uint32_t name_capacity,
    std::uint8_t* string_buffer, std::uint32_t string_capacity,
    std::uint32_t* out_candidate_count, std::uint32_t* out_name_count,
    std::uint32_t* out_string_bytes, std::uint32_t* out_generation) {
    if (handle == nullptr || request == nullptr || out_candidate_count == nullptr ||
        out_name_count == nullptr || out_string_bytes == nullptr ||
        out_generation == nullptr) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    auto* resolver = reinterpret_cast<Resolver*>(handle);
    try {
        if (!resolver->EnterCall()) {
            return SCUT_FONT_STALE_CANDIDATE;
        }
        CallGuard call_guard(resolver);
        ComApartmentScope apartment;
        if (FAILED(apartment.result)) {
            std::lock_guard<std::mutex> lock(resolver->Mutex());
            resolver->SetErrorUnlocked(SCUT_FONT_COM_INITIALIZATION_FAILED,
                                       SCUT_FONT_ERROR_COM, apartment.result,
                                       "CoInitializeEx failed");
            return SCUT_FONT_COM_INITIALIZATION_FAILED;
        }
        std::lock_guard<std::mutex> lock(resolver->Mutex());
        return resolver->EnumerateUnlocked(
            request, candidates, candidate_capacity, names, name_capacity,
            string_buffer, string_capacity, out_candidate_count, out_name_count,
            out_string_bytes, out_generation);
    } catch (...) {
        return SCUT_FONT_INTERNAL_ERROR;
    }
}

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_inspect_face(
    SCUT_FONT_RESOLVER_HANDLE handle, const SCUT_FONT_FACE_REQUEST* request,
    SCUT_FONT_FACE_RECORD* face, SCUT_FONT_FILE_RECORD* files,
    std::uint32_t file_capacity, SCUT_FONT_GLYPH_RECORD* glyphs,
    std::uint32_t glyph_capacity, std::uint8_t* string_buffer,
    std::uint32_t string_capacity, std::uint32_t* out_file_count,
    std::uint32_t* out_glyph_count, std::uint32_t* out_string_bytes) {
    if (handle == nullptr || request == nullptr || out_file_count == nullptr ||
        out_glyph_count == nullptr || out_string_bytes == nullptr) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    auto* resolver = reinterpret_cast<Resolver*>(handle);
    try {
        if (!resolver->EnterCall()) {
            return SCUT_FONT_STALE_CANDIDATE;
        }
        CallGuard call_guard(resolver);
        ComApartmentScope apartment;
        if (FAILED(apartment.result)) {
            std::lock_guard<std::mutex> lock(resolver->Mutex());
            resolver->SetErrorUnlocked(SCUT_FONT_COM_INITIALIZATION_FAILED,
                                       SCUT_FONT_ERROR_COM, apartment.result,
                                       "CoInitializeEx failed");
            return SCUT_FONT_COM_INITIALIZATION_FAILED;
        }
        std::lock_guard<std::mutex> lock(resolver->Mutex());
        return resolver->InspectFaceUnlocked(
            request, face, files, file_capacity, glyphs, glyph_capacity,
            string_buffer, string_capacity, out_file_count, out_glyph_count,
            out_string_bytes);
    } catch (...) {
        return SCUT_FONT_INTERNAL_ERROR;
    }
}

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_get_error(
    SCUT_FONT_RESOLVER_HANDLE handle, SCUT_FONT_ERROR* error,
    std::uint8_t* detail_buffer, std::uint32_t detail_capacity,
    std::uint32_t* out_detail_bytes) {
    if (handle == nullptr || error == nullptr || out_detail_bytes == nullptr) {
        return SCUT_FONT_INVALID_ARGUMENT;
    }
    if (!ValidHeader(error->abi_version, error->struct_size, sizeof(SCUT_FONT_ERROR))) {
        return SCUT_FONT_ABI_MISMATCH;
    }
    auto* resolver = reinterpret_cast<Resolver*>(handle);
    try {
        if (!resolver->EnterCall()) {
            return SCUT_FONT_STALE_CANDIDATE;
        }
        CallGuard call_guard(resolver);
        std::lock_guard<std::mutex> lock(resolver->Mutex());
        const auto& state = resolver->Error();
        const std::size_t bytes = state.detail_length;
        *out_detail_bytes = state.detail_length;
        error->abi_version = SCUT_FONT_ABI_VERSION;
        error->struct_size = sizeof(SCUT_FONT_ERROR);
        error->category = state.category;
        error->status = state.status;
        error->hresult = state.hresult;
        error->detail_bytes = state.detail_length;
        if (detail_capacity < bytes || (bytes != 0 && detail_buffer == nullptr)) {
            return SCUT_FONT_BUFFER_TOO_SMALL;
        }
        if (bytes != 0) {
            std::memcpy(detail_buffer, state.detail, bytes);
        }
        return SCUT_FONT_OK;
    } catch (...) {
        return SCUT_FONT_INTERNAL_ERROR;
    }
}
