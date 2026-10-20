// Minimal OpenSSL MD5 API (upstream OrcaSlicer's file checksums in utils.cpp
// and bbs_3mf.cpp) on the EVP stand-in in evp.h; Snapmaker Orca uses EVP directly.
#pragma once

#include "evp.h"

#define MD5_DIGEST_LENGTH 16

typedef EVP_MD_CTX MD5_CTX;

inline int MD5_Init(MD5_CTX* c) { return EVP_DigestInit_ex(c, EVP_md5(), nullptr); }
inline int MD5_Update(MD5_CTX* c, const void* data, size_t len) { return EVP_DigestUpdate(c, data, len); }
inline int MD5_Final(unsigned char* md, MD5_CTX* c) { return EVP_DigestFinal_ex(c, md, nullptr); }
