#include "spc.h"

#include "der.h"
#include "digest.h"

namespace cs {
namespace spc {

namespace {
const char *kSpcPeImageData = "1.3.6.1.4.1.311.2.1.15";
} // namespace

std::string build(const std::string &file_digest, const std::string &algorithm) {
    // SpcString ::= unicode [0] IMPLICIT BMPSTRING
    // 实际签出来的（Certum 自己的 PE 也一样）是空串，而不是微软文档里的 ">>"
    std::string spc_string = der::context_primitive(0, der::bmp_string(""));

    // SpcLink ::= file [2] EXPLICIT SpcString
    std::string spc_link = der::context(2, spc_string);

    // SpcPeImageData ::= SEQUENCE { flags BIT STRING, file SpcLink }
    // 注意：真实编码里 file 被标成了 [0] EXPLICIT（文档写的是无标签），
    // 而 SpcAttributeTypeAndOptionalValue.value 反而是无标签的 SEQUENCE。
    // 这两处的标签与微软文档正好相反，以实际签名为准，否则 Windows 会拒绝。
    std::string pe_image = der::sequence(der::bit_string(std::string(), 0) + der::context(0, spc_link));

    // SpcAttributeTypeAndOptionalValue ::= SEQUENCE { type OID, value SEQUENCE }
    std::string attribute = der::sequence(der::oid(kSpcPeImageData) + pe_image);

    // DigestInfo ::= SEQUENCE { digestAlgorithm, digest OCTET STRING }
    const char *oid = digest::oid(algorithm);
    if (!oid) return {};
    std::string digest_info = der::sequence(der::algorithm_identifier(oid) + der::octet_string(file_digest));

    return der::sequence(attribute + digest_info);
}

} // namespace spc
} // namespace cs
