#include "keygen.h"

#include "util.h"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <vector>

namespace cs {
namespace keygen {

namespace {

constexpr int kRandomBytes = 24;

/** base64url（无填充），与服务端 randomToken 生成的形状一致 */
std::string base64_url(const std::string &bytes) {
    std::string text = base64_encode(bytes);
    while (!text.empty() && text.back() == '=') text.pop_back();
    for (char &ch : text) {
        if (ch == '+') ch = '-';
        else if (ch == '/') ch = '_';
    }
    return text;
}

} // namespace

std::string sha256_hex(const std::string &text) {
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (!ctx) return std::string();
    const bool ok = EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr) == 1 &&
                    EVP_DigestUpdate(ctx, text.data(), text.size()) == 1 &&
                    EVP_DigestFinal_ex(ctx, digest, &length) == 1;
    EVP_MD_CTX_free(ctx);
    if (!ok) return std::string();
    return to_hex(digest, length);
}

bool generate(std::string &plaintext, std::string &hash_hex, std::string &prefix, std::string &err) {
    err.clear();
    plaintext.clear();
    hash_hex.clear();
    prefix.clear();

    std::string bytes(static_cast<size_t>(kRandomBytes), '\0');
    if (RAND_bytes(reinterpret_cast<unsigned char *>(bytes.data()), kRandomBytes) != 1) {
        err = "生成随机数失败";
        return false;
    }

    plaintext = "csk_" + base64_url(bytes);
    hash_hex = sha256_hex(plaintext);
    if (hash_hex.size() != 64) {
        err = "计算 Key 哈希失败";
        plaintext.clear();
        return false;
    }
    prefix = plaintext.substr(0, 12);
    return true;
}

} // namespace keygen
} // namespace cs
