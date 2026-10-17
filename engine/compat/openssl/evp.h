// Minimal OpenSSL EVP digest API (MD5 only) on top of Boost's header-only MD5.
// libslic3r only uses EVP MD5 for file checksums (utils.cpp); pulling OpenSSL
// into the wasm module for that is not worth it.
#pragma once

#include <boost/uuid/detail/md5.hpp>
#include <cstddef>
#include <cstdint>

#define EVP_MAX_MD_SIZE 64

struct EVP_MD { int unused; };
struct ENGINE;
struct EVP_MD_CTX {
    boost::uuids::detail::md5 h;
};

inline const EVP_MD* EVP_md5() {
    static const EVP_MD md{0};
    return &md;
}
inline EVP_MD_CTX* EVP_MD_CTX_new() { return new EVP_MD_CTX(); }
inline void EVP_MD_CTX_free(EVP_MD_CTX* c) { delete c; }
inline int EVP_DigestInit_ex(EVP_MD_CTX* c, const EVP_MD*, ENGINE*) {
    c->h = boost::uuids::detail::md5();
    return 1;
}
inline int EVP_DigestUpdate(EVP_MD_CTX* c, const void* data, size_t len) {
    c->h.process_bytes(data, len);
    return 1;
}
inline int EVP_DigestFinal_ex(EVP_MD_CTX* c, unsigned char* md, unsigned int* size) {
    boost::uuids::detail::md5::digest_type d;
    c->h.get_digest(d);
    // Boost stores the digest as four 32-bit words in native (little-endian on
    // wasm) order; emit the canonical big-endian byte order OpenSSL uses.
    for (int i = 0; i < 4; ++i) {
        const uint32_t w = d[i];
        md[i * 4 + 0] = static_cast<unsigned char>((w >> 24) & 0xff);
        md[i * 4 + 1] = static_cast<unsigned char>((w >> 16) & 0xff);
        md[i * 4 + 2] = static_cast<unsigned char>((w >> 8) & 0xff);
        md[i * 4 + 3] = static_cast<unsigned char>(w & 0xff);
    }
    if (size) *size = 16;
    return 1;
}
