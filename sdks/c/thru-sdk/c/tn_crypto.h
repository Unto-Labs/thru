#ifndef HEADER_tn_src_thru_consensus_tn_crypto_h
#define HEADER_tn_src_thru_consensus_tn_crypto_h

#include <blst.h>

#ifndef IN_SMART_CONTRACT
  #if defined(__has_include)
    #if __has_include("tn_sdk.h")
      #define IN_SMART_CONTRACT 1
    #else
      #define IN_SMART_CONTRACT 0
    #endif
  #else
    #error "IN_SMART_CONTRACT not defined and __has_include not available; define it before including state.h"
  #endif
#endif

#if IN_SMART_CONTRACT
#include "tn_sdk_base.h"
#define LIKELY TSDK_LIKELY
#define UNLIKELY TSDK_UNLIKELY
#define FN_CONST TSDK_FN_CONST
#else
#include "../../../firedancer/src/util/fd_util.h"
#define LIKELY FD_LIKELY
#define UNLIKELY FD_UNLIKELY
#define FN_CONST FD_FN_CONST
#endif

/* Error codes for crypto operations */
#define TN_CRYPTO_SUCCESS 0
#define TN_CRYPTO_ERR_INVALID_PARAM -1
#define TN_CRYPTO_ERR_KEYGEN_FAILED -2
#define TN_CRYPTO_ERR_SIGN_FAILED -3
#define TN_CRYPTO_ERR_VERIFY_FAILED -4
#define TN_CRYPTO_ERR_AGGREGATE_FAILED -5
#define TN_CRYPTO_ERR_INVALID_PUBKEY -6

/* BLS types for certificates - use actual blst types */
typedef blst_scalar tn_bls_private_key_t;
typedef blst_p1_affine tn_bls_pubkey_t;
typedef blst_p2_affine tn_bls_signature_t;

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

/* tn_crypto_pubkey_on_curve verifies a pubkey lies on the BLS12-381 curve */
int tn_crypto_pubkey_on_curve(tn_bls_pubkey_t const* pubkey);

#endif /* HEADER_tn_src_thru_consensus_tn_crypto_h */
