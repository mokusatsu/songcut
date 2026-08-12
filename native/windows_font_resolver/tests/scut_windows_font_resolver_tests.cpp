#include "scut_windows_font_resolver.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

namespace {

bool Check(bool condition, const char* message) {
    if (!condition) {
        std::fprintf(stderr, "native font resolver test failed: %s\n", message);
        return false;
    }
    return true;
}

}  // namespace

int main() {
    SCUT_FONT_RESOLVER_HANDLE invalid_handle = nullptr;
    if (!Check(scut_font_resolver_create(nullptr, &invalid_handle) ==
                   SCUT_FONT_INVALID_ARGUMENT && invalid_handle == nullptr,
               "null create request")) {
        return 1;
    }
    SCUT_FONT_CREATE_REQUEST wrong_version{};
    wrong_version.abi_version = SCUT_FONT_ABI_VERSION + 1;
    wrong_version.struct_size = sizeof(wrong_version);
    if (!Check(scut_font_resolver_create(&wrong_version, &invalid_handle) ==
                   SCUT_FONT_ABI_MISMATCH,
               "ABI mismatch")) {
        return 1;
    }
    SCUT_FONT_CREATE_REQUEST create{};
    create.abi_version = SCUT_FONT_ABI_VERSION;
    create.struct_size = sizeof(create);
    SCUT_FONT_RESOLVER_HANDLE handle = nullptr;
    if (!Check(scut_font_resolver_create(&create, &handle) == SCUT_FONT_OK &&
                   handle != nullptr,
               "create")) {
        return 1;
    }

    SCUT_FONT_ENUM_REQUEST enumerate{};
    enumerate.abi_version = SCUT_FONT_ABI_VERSION;
    enumerate.struct_size = sizeof(enumerate);
    std::uint32_t candidate_count = 0;
    std::uint32_t name_count = 0;
    std::uint32_t string_bytes = 0;
    std::uint32_t generation = 0;
    SCUT_FONT_ENUM_REQUEST wrong_enum = enumerate;
    wrong_enum.abi_version = SCUT_FONT_ABI_VERSION + 1;
    if (!Check(scut_font_resolver_enumerate(
                   handle, &wrong_enum, nullptr, 0, nullptr, 0, nullptr, 0,
                   &candidate_count, &name_count, &string_bytes, &generation) ==
                   SCUT_FONT_ABI_MISMATCH,
               "enumerate ABI mismatch")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    if (!Check(scut_font_resolver_enumerate(
                   handle, &enumerate, nullptr, 1,
                   nullptr, 0, nullptr, 0, &candidate_count, &name_count,
                   &string_bytes, &generation) == SCUT_FONT_INVALID_ARGUMENT,
               "enumerate null capacity")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    SCUT_FONT_STATUS status = scut_font_resolver_enumerate(
        handle, &enumerate, nullptr, 0, nullptr, 0, nullptr, 0,
        &candidate_count, &name_count, &string_bytes, &generation);
    if (!Check(status == SCUT_FONT_BUFFER_TOO_SMALL && candidate_count > 0 &&
                   generation != 0,
               "enumerate sizing")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }

    std::vector<SCUT_FONT_CANDIDATE_RECORD> candidates(candidate_count);
    std::vector<SCUT_FONT_NAME_RECORD> names(name_count);
    std::vector<std::uint8_t> strings(string_bytes);
    status = scut_font_resolver_enumerate(
        handle, &enumerate, candidates.data(), candidate_count, names.data(),
        name_count, strings.data(), string_bytes, &candidate_count, &name_count,
        &string_bytes, &generation);
    if (!Check(status == SCUT_FONT_OK, "enumerate output")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    for (std::size_t i = 0; i < candidates.size(); ++i) {
        if (!Check(candidates[i].abi_version == SCUT_FONT_ABI_VERSION &&
                       candidates[i].candidate_id != 0 &&
                       candidates[i].generation == generation,
                   "candidate ABI")) {
            scut_font_resolver_destroy(handle);
            return 1;
        }
        for (std::size_t j = i + 1; j < candidates.size(); ++j) {
            if (!Check(candidates[i].candidate_id != candidates[j].candidate_id,
                       "candidate IDs unique")) {
                scut_font_resolver_destroy(handle);
                return 1;
            }
        }
    }

    const std::uint32_t codepoints[] = {0x41u, 0x1f600u};
    SCUT_FONT_FACE_REQUEST face_request{};
    face_request.abi_version = SCUT_FONT_ABI_VERSION;
    face_request.struct_size = sizeof(face_request);
    face_request.candidate_id = candidates.front().candidate_id;
    face_request.generation = generation;
    face_request.codepoints = codepoints;
    face_request.codepoint_count = 2;
    SCUT_FONT_FACE_RECORD face{};
    std::uint32_t file_count = 0;
    std::uint32_t glyph_count = 0;
    std::uint32_t face_string_bytes = 0;
    SCUT_FONT_FACE_REQUEST malformed_face = face_request;
    malformed_face.codepoints = nullptr;
    if (!Check(scut_font_resolver_inspect_face(
                   handle, &malformed_face, nullptr, nullptr, 0, nullptr, 0,
                   nullptr, 0, &file_count, &glyph_count, &face_string_bytes) ==
                   SCUT_FONT_INVALID_ARGUMENT,
               "face null codepoint array")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    status = scut_font_resolver_inspect_face(
        handle, &face_request, nullptr, nullptr, 0, nullptr, 0, nullptr, 0,
        &file_count, &glyph_count, &face_string_bytes);
    if (!Check(status == SCUT_FONT_BUFFER_TOO_SMALL && glyph_count == 2,
               "face sizing")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    std::vector<SCUT_FONT_FILE_RECORD> files(file_count);
    std::vector<SCUT_FONT_GLYPH_RECORD> glyphs(glyph_count);
    std::vector<std::uint8_t> face_strings(face_string_bytes);
    status = scut_font_resolver_inspect_face(
        handle, &face_request, &face, files.data(), file_count, glyphs.data(),
        glyph_count, face_strings.data(), face_string_bytes, &file_count,
        &glyph_count, &face_string_bytes);
    if (!Check(status == SCUT_FONT_OK &&
                   face.abi_version == SCUT_FONT_ABI_VERSION &&
                   face.glyph_count == 2,
               "face output")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    if (!Check(scut_font_resolver_refresh(handle, &generation) == SCUT_FONT_OK,
               "refresh")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    status = scut_font_resolver_inspect_face(
        handle, &face_request, nullptr, nullptr, 0, nullptr, 0, nullptr, 0,
        &file_count, &glyph_count, &face_string_bytes);
    if (!Check(status == SCUT_FONT_STALE_CANDIDATE, "stale candidate")) {
        scut_font_resolver_destroy(handle);
        return 1;
    }
    scut_font_resolver_destroy(handle);
    std::puts("songcut native font resolver tests: ok");
    return 0;
}
