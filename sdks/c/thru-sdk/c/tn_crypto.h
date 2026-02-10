#ifndef HEADER_tn_src_thru_consensus_tn_crypto_h
#define HEADER_tn_src_thru_consensus_tn_crypto_h

#include <blst.h>

/* Detect smart contract build via THRU_VM flag set by thruvm.mk */
#ifdef THRU_VM
#include "tn_sdk_base.h"
#define LIKELY TSDK_LIKELY
#define UNLIKELY TSDK_UNLIKELY
#define FN_CONST TSDK_FN_CONST
#ifndef FD_LOG_WARNING
#define FD_LOG_WARNING( a ) ;
#endif
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
#define TN_CRYPTO_ERR_SERIALIZE_FAILED -7
#define TN_CRYPTO_ERR_DESERIALIZE_FAILED -8

/* BLS types for certificates - use actual blst types */
typedef blst_scalar    tn_bls_private_key_t;
typedef blst_p1_affine tn_bls_pubkey_t;
typedef blst_p2_affine tn_bls_signature_t;

/* Serialized point sizes for wire format */
#define TN_CRYPTO_G1_UNCOMPRESSED_SIZE (96UL)  /* G1 uncompressed: x (48) + y (48) */
#define TN_CRYPTO_G2_UNCOMPRESSED_SIZE (192UL) /* G2 uncompressed: x (96) + y (96) */

/* Serialized types for wire format */
/* Pubkeys use uncompressed format (96 bytes) */
typedef uchar tn_bls_serialized_pubkey_t[TN_CRYPTO_G1_UNCOMPRESSED_SIZE];
/* Signatures use uncompressed format (192 bytes) */
typedef uchar tn_bls_serialized_signature_t[TN_CRYPTO_G2_UNCOMPRESSED_SIZE];

/* tn_crypto_generate_keypair generates a BLS keypair */
int tn_crypto_generate_keypair( tn_bls_pubkey_t * pubkey,
                                tn_bls_private_key_t * private_key, ulong seed );

/* tn_crypto_sign_message signs a message with a private key */
int tn_crypto_sign_message( tn_bls_signature_t * signature, void const * message,
                            ulong message_len,
                            tn_bls_private_key_t const * private_key );

/* tn_crypto_verify_signature verifies a single signature */
int tn_crypto_verify_signature( tn_bls_signature_t const * signature,
                                tn_bls_pubkey_t const * pubkey,
                                void const * message, ulong message_len );

/* tn_crypto_aggregate_signatures aggregates two signatures */
int tn_crypto_aggregate_signatures( tn_bls_signature_t *       aggregate,
                                    tn_bls_signature_t const * sig1,
                                    tn_bls_signature_t const * sig2 );

/* tn_crypto_aggregate_pubkeys aggregates two public keys */
int tn_crypto_aggregate_pubkeys( tn_bls_pubkey_t *       aggregate,
                                 tn_bls_pubkey_t const * pk1,
                                 tn_bls_pubkey_t const * pk2 );

/* tn_crypto_subtract_signature subtracts a signature from aggregate */
int tn_crypto_subtract_signature( tn_bls_signature_t *       aggregate,
                                  tn_bls_signature_t const * to_subtract );

/* tn_crypto_subtract_pubkey subtracts a pubkey from aggregate */
int tn_crypto_subtract_pubkey( tn_bls_pubkey_t *       aggregate,
                               tn_bls_pubkey_t const * to_subtract );

/* tn_crypto_verify_aggregate verifies an aggregate signature */
int tn_crypto_verify_aggregate( tn_bls_signature_t const * aggregate_sig,
                                tn_bls_pubkey_t const * aggregate_pk,
                                void const * message, ulong message_len );

/* tn_crypto_pubkey_on_curve verifies a pubkey lies on the BLS12-381 curve */
int tn_crypto_pubkey_on_curve( tn_bls_pubkey_t const * pubkey );

/* tn_crypto_derive_pubkey derives a BLS public key from a private key */
int
tn_crypto_derive_pubkey( tn_bls_pubkey_t *            pubkey,
                         tn_bls_private_key_t const * private_key );

/* Serialization functions for wire format */

/* tn_crypto_serialize_pubkey serializes a G1 pubkey to uncompressed format */
int
tn_crypto_serialize_pubkey( tn_bls_serialized_pubkey_t      serialized,
                            tn_bls_pubkey_t const *         pubkey );

/* tn_crypto_deserialize_pubkey deserializes an uncompressed G1 pubkey */
int
tn_crypto_deserialize_pubkey( tn_bls_pubkey_t *                pubkey,
                              tn_bls_serialized_pubkey_t const serialized );

/* tn_crypto_serialize_signature serializes a G2 signature to uncompressed format */
int
tn_crypto_serialize_signature( tn_bls_serialized_signature_t      serialized,
                               tn_bls_signature_t const *         signature );

/* tn_crypto_deserialize_signature deserializes an uncompressed G2 signature */
int
tn_crypto_deserialize_signature( tn_bls_signature_t *                signature,
                                 tn_bls_serialized_signature_t const serialized );

#endif /* HEADER_tn_src_thru_consensus_tn_crypto_h */

