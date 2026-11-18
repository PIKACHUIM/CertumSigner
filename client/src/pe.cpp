#include "pe.h"

#include "util.h"

#include <openssl/evp.h>

#include <cstring>

namespace cs {
namespace pe {

namespace {

uint16_t rd16(const std::string &data, size_t offset) {
    return static_cast<uint16_t>(static_cast<unsigned char>(data[offset]) |
                                 (static_cast<unsigned char>(data[offset + 1]) << 8));
}

uint32_t rd32(const std::string &data, size_t offset) {
    return static_cast<uint32_t>(static_cast<unsigned char>(data[offset])) |
           (static_cast<uint32_t>(static_cast<unsigned char>(data[offset + 1])) << 8) |
           (static_cast<uint32_t>(static_cast<unsigned char>(data[offset + 2])) << 16) |
           (static_cast<uint32_t>(static_cast<unsigned char>(data[offset + 3])) << 24);
}

void wr16(std::string &data, size_t offset, uint16_t value) {
    data[offset] = static_cast<char>(value & 0xFF);
    data[offset + 1] = static_cast<char>((value >> 8) & 0xFF);
}

void wr32(std::string &data, size_t offset, uint32_t value) {
    for (int i = 0; i < 4; i++) {
        data[offset + static_cast<size_t>(i)] = static_cast<char>((value >> (8 * i)) & 0xFF);
    }
}

uint32_t compute_checksum(const std::string &data, size_t checksum_offset) {
    // 官方算法：把 Checksum 字段当成 0，按 16 位累加并折叠进位，最后加上文件长度
    std::string copy = data;
    if (checksum_offset + 4 <= copy.size()) {
        std::memset(&copy[checksum_offset], 0, 4);
    }
    uint64_t sum = 0;
    size_t i = 0;
    for (; i + 1 < copy.size(); i += 2) {
        uint16_t word = static_cast<uint16_t>(static_cast<unsigned char>(copy[i]) |
                                             (static_cast<unsigned char>(copy[i + 1]) << 8));
        sum += word;
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    if (i < copy.size()) {
        sum += static_cast<unsigned char>(copy[i]);
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    sum = (sum & 0xFFFF) + (sum >> 16);
    uint32_t checksum = static_cast<uint32_t>(sum) + static_cast<uint32_t>(data.size());
    return checksum;
}

} // namespace

bool analyze(const std::string &data, Layout &out, std::string &err) {
    out = Layout();
    out.file_size = data.size();

    if (data.size() < 0x40) {
        err = "文件太小，不是 PE 文件";
        return false;
    }
    if (data[0] != 'M' || data[1] != 'Z') {
        err = "缺少 MZ 头，不是 Windows PE 文件";
        return false;
    }

    size_t pe_offset = rd32(data, 0x3C);
    if (pe_offset + 24 > data.size()) {
        err = "PE 头偏移越界";
        return false;
    }
    if (data.compare(pe_offset, 4, "PE\0\0", 4) != 0) {
        err = "缺少 PE 签名";
        return false;
    }

    size_t coff = pe_offset + 4;
    size_t optional = coff + 20;
    uint16_t optional_size = rd16(data, coff + 16);
    if (optional + optional_size > data.size()) {
        err = "可选头越界";
        return false;
    }

    uint16_t magic = rd16(data, optional);
    size_t data_dir = 0;
    if (magic == 0x10B) {
        data_dir = optional + 96;
        out.checksum_offset = optional + 64;
    } else if (magic == 0x20B) {
        data_dir = optional + 112;
        out.checksum_offset = optional + 64;
    } else {
        err = "未知的 PE 可选头格式（不是 PE32/PE32+）";
        return false;
    }

    size_t security_dir = data_dir + 4 * 8;
    if (security_dir + 8 > optional + optional_size) {
        err = "PE 没有证书表目录项";
        return false;
    }
    out.security_dir_offset = security_dir;

    out.cert_table_offset = rd32(data, security_dir);
    out.cert_table_size = rd32(data, security_dir + 4);
    if (out.cert_table_offset >= data.size()) {
        // 头部写了偏移但文件里没有对应内容：按“没有签名”处理
        out.cert_table_offset = 0;
        out.cert_table_size = 0;
    }

    out.valid = true;
    return true;
}

bool analyze_file(const std::string &path, Layout &out, std::string &err) {
    std::string data;
    if (!read_file(path, data, err)) return false;
    return analyze(data, out, err);
}

bool authentihash(const std::string &path, bool sha1, std::string &digest, std::string &err) {
    std::string data;
    if (!read_file(path, data, err)) return false;

    Layout layout;
    if (!analyze(data, layout, err)) return false;

    size_t cert_start = layout.cert_table_offset > 0 ? layout.cert_table_offset : data.size();
    if (cert_start > data.size()) cert_start = data.size();

    const size_t after_checksum = layout.checksum_offset + 4;
    const size_t after_security = layout.security_dir_offset + 8;
    if (after_checksum > layout.security_dir_offset || after_security > cert_start) {
        err = "PE 头部区间异常，无法计算摘要";
        return false;
    }

    const EVP_MD *md = sha1 ? EVP_sha1() : EVP_sha256();
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (!ctx) {
        err = "无法创建摘要上下文";
        return false;
    }

    bool ok = EVP_DigestInit_ex(ctx, md, nullptr) == 1;
    auto update = [&](size_t from, size_t to) {
        if (!ok || to <= from) return;
        ok = EVP_DigestUpdate(ctx, data.data() + from, to - from) == 1;
    };

    update(0, layout.checksum_offset);
    update(after_checksum, layout.security_dir_offset);
    update(after_security, cert_start);

    unsigned char out_bytes[EVP_MAX_MD_SIZE];
    unsigned int out_len = 0;
    if (ok) ok = EVP_DigestFinal_ex(ctx, out_bytes, &out_len) == 1;
    EVP_MD_CTX_free(ctx);

    if (!ok) {
        err = "计算 Authenticode 摘要失败";
        return false;
    }
    digest.assign(reinterpret_cast<char *>(out_bytes), out_len);
    return true;
}

bool embed(const std::string &path, const std::string &pkcs7, std::string &err) {
    std::string data;
    if (!read_file(path, data, err)) return false;

    Layout layout;
    if (!analyze(data, layout, err)) return false;
    if (pkcs7.empty()) {
        err = "PKCS#7 内容为空";
        return false;
    }

    size_t base = layout.cert_table_offset > 0 ? layout.cert_table_offset : data.size();
    if (base > data.size()) base = data.size();
    data.resize(base);

    // 证书表必须 8 字节对齐
    while (data.size() % 8 != 0) data.push_back('\0');

    const size_t entry_offset = data.size();
    const size_t total = 8 + pkcs7.size();
    const size_t padded = (total + 7) & ~static_cast<size_t>(7);

    std::string entry;
    entry.reserve(padded);
    entry.push_back(static_cast<char>(padded & 0xFF));
    entry.push_back(static_cast<char>((padded >> 8) & 0xFF));
    entry.push_back(static_cast<char>((padded >> 16) & 0xFF));
    entry.push_back(static_cast<char>((padded >> 24) & 0xFF));
    entry.push_back(static_cast<char>(0x00)); // wRevision = 0x0200
    entry.push_back(static_cast<char>(0x02));
    entry.push_back(static_cast<char>(0x02)); // wCertificateType = 0x0002 (PKCS_SIGNED_DATA)
    entry.push_back(static_cast<char>(0x00));
    entry += pkcs7;
    entry.resize(padded, '\0');
    data += entry;

    wr32(data, layout.security_dir_offset, static_cast<uint32_t>(entry_offset));
    wr32(data, layout.security_dir_offset + 4, static_cast<uint32_t>(padded));

    uint32_t checksum = compute_checksum(data, layout.checksum_offset);
    wr32(data, layout.checksum_offset, checksum);

    return write_file(path, data, err);
}

bool has_signature(const std::string &path) {
    Layout layout;
    std::string err;
    if (!analyze_file(path, layout, err)) return false;
    return layout.cert_table_offset != 0 && layout.cert_table_size != 0;
}

} // namespace pe
} // namespace cs
