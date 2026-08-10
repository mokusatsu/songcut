#pragma once

// Versioned, policy-free DirectWrite ABI used by SongCut's Python resolver.
//
// All structures are POD and start with abi_version/struct_size.  Strings in
// enumerate/inspect_face are UTF-16LE bytes in a caller-owned blob.  Offsets
// and lengths are bytes, not wchar_t units.  A call with null output arrays (or
// capacities of zero) performs the same validation and returns
// SCUT_FONT_BUFFER_TOO_SMALL while reporting the required element counts and
// blob size.  The caller then allocates its own arrays/blob and calls again.
// The DLL never allocates memory returned to the caller.

#include <stdint.h>

#if defined(_WIN32)
#  define SCUT_FONT_API __declspec(dllexport)
#  define SCUT_FONT_CALL __cdecl
#else
#  define SCUT_FONT_API
#  define SCUT_FONT_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SCUT_FONT_ABI_VERSION 1u

typedef void* SCUT_FONT_RESOLVER_HANDLE;

typedef enum SCUT_FONT_STATUS {
    SCUT_FONT_OK = 0,
    SCUT_FONT_INVALID_ARGUMENT = 1,
    SCUT_FONT_ABI_MISMATCH = 2,
    SCUT_FONT_BUFFER_TOO_SMALL = 3,
    SCUT_FONT_COM_INITIALIZATION_FAILED = 4,
    SCUT_FONT_DIRECTWRITE_ERROR = 5,
    SCUT_FONT_STALE_CANDIDATE = 6,
    SCUT_FONT_INTERNAL_ERROR = 7
} SCUT_FONT_STATUS;

typedef enum SCUT_FONT_ERROR_CATEGORY {
    SCUT_FONT_ERROR_NONE = 0,
    SCUT_FONT_ERROR_ARGUMENT = 1,
    SCUT_FONT_ERROR_ABI = 2,
    SCUT_FONT_ERROR_BUFFER = 3,
    SCUT_FONT_ERROR_COM = 4,
    SCUT_FONT_ERROR_DIRECTWRITE = 5,
    SCUT_FONT_ERROR_CANDIDATE = 6,
    SCUT_FONT_ERROR_INTERNAL = 7
} SCUT_FONT_ERROR_CATEGORY;

typedef enum SCUT_FONT_NAME_KIND {
    SCUT_FONT_NAME_FAMILY = 1,
    SCUT_FONT_NAME_FACE = 2,
    SCUT_FONT_NAME_FULL = 3,
    SCUT_FONT_NAME_POSTSCRIPT = 4
} SCUT_FONT_NAME_KIND;

enum {
    SCUT_FONT_FACE_CREATED = 1u << 0,
    SCUT_FONT_LOCAL_LOADER_AVAILABLE = 1u << 1,
    SCUT_FONT_PATH_RESOLVED = 1u << 2,
    SCUT_FONT_MULTIPLE_FILES = 1u << 3,
    SCUT_FONT_GLYPH_QUERY_FAILED = 1u << 4
};

typedef struct SCUT_FONT_CREATE_REQUEST {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t flags;
    uint32_t reserved;
} SCUT_FONT_CREATE_REQUEST;

typedef struct SCUT_FONT_ENUM_REQUEST {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t flags;
    uint32_t reserved;
} SCUT_FONT_ENUM_REQUEST;

typedef struct SCUT_FONT_CANDIDATE_RECORD {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t candidate_id;
    uint32_t generation;
    uint32_t family_index;
    uint32_t font_index;
    uint32_t weight;
    uint32_t style;
    uint32_t stretch;
    uint32_t simulations;
    uint32_t first_name;
    uint32_t name_count;
} SCUT_FONT_CANDIDATE_RECORD;

typedef struct SCUT_FONT_NAME_RECORD {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t candidate_id;
    uint32_t kind;
    uint32_t locale_offset;
    uint32_t locale_length;
    uint32_t value_offset;
    uint32_t value_length;
} SCUT_FONT_NAME_RECORD;

typedef struct SCUT_FONT_FACE_REQUEST {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t candidate_id;
    uint32_t generation;
    uint32_t flags;
    const uint32_t* codepoints;
    uint32_t codepoint_count;
    uint32_t reserved;
} SCUT_FONT_FACE_REQUEST;

typedef struct SCUT_FONT_FACE_RECORD {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t candidate_id;
    uint32_t generation;
    int32_t hresult;
    uint32_t status_flags;
    uint32_t face_index;
    uint32_t simulations;
    uint32_t file_count;
    uint32_t local_file_count;
    uint32_t glyph_count;
    uint32_t first_file;
    uint32_t first_glyph;
    uint32_t path_offset;
    uint32_t path_length;
    int32_t glyph_hresult;
} SCUT_FONT_FACE_RECORD;

typedef struct SCUT_FONT_FILE_RECORD {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t candidate_id;
    uint32_t file_index;
    uint32_t local_loader_available;
    uint32_t key_size;
    int32_t loader_hresult;
    uint32_t path_offset;
    uint32_t path_length;
} SCUT_FONT_FILE_RECORD;

typedef struct SCUT_FONT_GLYPH_RECORD {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t codepoint;
    uint16_t glyph_index;
    uint16_t flags;
    int32_t hresult;
} SCUT_FONT_GLYPH_RECORD;

typedef struct SCUT_FONT_ERROR {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t category;
    int32_t status;
    int32_t hresult;
    uint32_t detail_bytes;
} SCUT_FONT_ERROR;

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_create(
    const SCUT_FONT_CREATE_REQUEST* request,
    SCUT_FONT_RESOLVER_HANDLE* out_handle);

SCUT_FONT_API void SCUT_FONT_CALL scut_font_resolver_destroy(
    SCUT_FONT_RESOLVER_HANDLE handle);

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_refresh(
    SCUT_FONT_RESOLVER_HANDLE handle,
    uint32_t* out_generation);

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_enumerate(
    SCUT_FONT_RESOLVER_HANDLE handle,
    const SCUT_FONT_ENUM_REQUEST* request,
    SCUT_FONT_CANDIDATE_RECORD* candidates,
    uint32_t candidate_capacity,
    SCUT_FONT_NAME_RECORD* names,
    uint32_t name_capacity,
    uint8_t* string_buffer,
    uint32_t string_capacity,
    uint32_t* out_candidate_count,
    uint32_t* out_name_count,
    uint32_t* out_string_bytes,
    uint32_t* out_generation);

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_inspect_face(
    SCUT_FONT_RESOLVER_HANDLE handle,
    const SCUT_FONT_FACE_REQUEST* request,
    SCUT_FONT_FACE_RECORD* face,
    SCUT_FONT_FILE_RECORD* files,
    uint32_t file_capacity,
    SCUT_FONT_GLYPH_RECORD* glyphs,
    uint32_t glyph_capacity,
    uint8_t* string_buffer,
    uint32_t string_capacity,
    uint32_t* out_file_count,
    uint32_t* out_glyph_count,
    uint32_t* out_string_bytes);

SCUT_FONT_API SCUT_FONT_STATUS SCUT_FONT_CALL scut_font_resolver_get_error(
    SCUT_FONT_RESOLVER_HANDLE handle,
    SCUT_FONT_ERROR* error,
    uint8_t* detail_buffer,
    uint32_t detail_capacity,
    uint32_t* out_detail_bytes);

#ifdef __cplusplus
}  // extern "C"
#endif
