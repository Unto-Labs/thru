#ifndef HEADER_tn_src_thru_consensus_tn_crypto_h
#define HEADER_tn_src_thru_consensus_tn_crypto_h

#include "tn_sdk.h"
#include "tn_sdk_base.h"
#include <blst.h>

/* Error codes for crypto operations */
#define TN_CRYPTO_SUCCESS 0
#define TN_CRYPTO_ERR_INVALID_PARAM -1
#define TN_CRYPTO_ERR_KEYGEN_FAILED -2
#define TN_CRYPTO_ERR_SIGN_FAILED -3
#define TN_CRYPTO_ERR_VERIFY_FAILED -4
#define TN_CRYPTO_ERR_AGGREGATE_FAILED -5

/* BLS types for certificates - use actual blst types */
typedef blst_scalar tn_bls_private_key_t;
typedef blst_p1_affine tn_bls_pubkey_t;
typedef blst_p2_affine tn_bls_signature_t;

TSDK_PROTOTYPES_BEGIN

/* tn_crypto_generate_keypair generates a BLS keypair */
int tn_crypto_generate_keypair(tn_bls_pubkey_t* pubkey,
                               tn_bls_private_key_t* private_key, ulong seed);

/* tn_crypto_sign_message signs a message with a private key */
int tn_crypto_sign_message(tn_bls_signature_t* signature, void const* message,
                           ulong message_len,
                           tn_bls_private_key_t const* private_key);

/* tn_crypto_verify_signature verifies a single signature */
int tn_crypto_verify_signature(tn_bls_signature_t const* signature,
                               tn_bls_pubkey_t const* pubkey,
                               void const* message, ulong message_len);

/* tn_crypto_aggregate_signatures aggregates two signatures */
int tn_crypto_aggregate_signatures(tn_bls_signature_t* aggregate,
                                   tn_bls_signature_t const* sig1,
                                   tn_bls_signature_t const* sig2);

/* tn_crypto_aggregate_pubkeys aggregates two public keys */
int tn_crypto_aggregate_pubkeys(tn_bls_pubkey_t* aggregate,
                                tn_bls_pubkey_t const* pk1,
                                tn_bls_pubkey_t const* pk2);

/* tn_crypto_subtract_signature subtracts a signature from aggregate */
int tn_crypto_subtract_signature(tn_bls_signature_t* aggregate,
                                 tn_bls_signature_t const* to_subtract);

/* tn_crypto_subtract_pubkey subtracts a pubkey from aggregate */
int tn_crypto_subtract_pubkey(tn_bls_pubkey_t* aggregate,
                              tn_bls_pubkey_t const* to_subtract);

/* tn_crypto_verify_aggregate verifies an aggregate signature */
int tn_crypto_verify_aggregate(tn_bls_signature_t const* aggregate_sig,
                               tn_bls_pubkey_t const* aggregate_pk,
                               void const* message, ulong message_len);

TSDK_PROTOTYPES_END

#endif /* HEADER_tn_src_thru_consensus_tn_crypto_h */
