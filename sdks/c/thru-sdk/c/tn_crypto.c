#include "tn_crypto.h"

/* Domain separation tag for consensus signatures */
static uchar const TN_CONSENSUS_DST[] = "TN_CONSENSUS_V1";

// WARNING: THIS IS NOT SECURE PLEASE DO NOT USE THIS OUTSIDE OF TESTING CODE
int tn_crypto_generate_keypair(tn_bls_pubkey_t* pubkey,
                               tn_bls_private_key_t* private_key, ulong seed) {
  if (UNLIKELY(!pubkey || !private_key)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Create deterministic key material from seed */
  uchar ikm[32];
  for (ulong i = 0; i < 32; i++) {
    ikm[i] = (uchar)((seed >> (i % 8)) ^ (i * 37));
  }

  /* Generate BLS private key using proper key derivation */
  blst_keygen(private_key, ikm, sizeof(ikm), NULL, 0);

  /* Generate corresponding public key */
  blst_p1 pubkey_proj;
  blst_sk_to_pk_in_g1(&pubkey_proj, private_key);

  /* Convert to affine coordinates */
  blst_p1_to_affine(pubkey, &pubkey_proj);

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_sign_message(tn_bls_signature_t* signature, void const* message,
                           ulong message_len,
                           tn_bls_private_key_t const* private_key) {
  if (UNLIKELY(!signature || !message || !private_key)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Hash message to G2 point */
  blst_p2 hash_point;
  blst_hash_to_g2(&hash_point, (uchar const*)message, message_len,
                  TN_CONSENSUS_DST, sizeof(TN_CONSENSUS_DST) - 1, NULL, 0);

  /* Sign by multiplying hash point by private key */
  blst_p2 sig_proj;
  blst_sign_pk_in_g1(&sig_proj, &hash_point, private_key);

  /* Convert to affine coordinates */
  blst_p2_to_affine(signature, &sig_proj);

  /* Group check signature (as recommended by blst README) */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "signature group check failed after signing" ));
    return TN_CRYPTO_ERR_SIGN_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_verify_signature(tn_bls_signature_t const* signature,
                               tn_bls_pubkey_t const* pubkey,
                               void const* message, ulong message_len) {
  if (UNLIKELY(!signature || !pubkey || !message)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Group check public key (as recommended by blst README) */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "public key group check failed" ));
    return TN_CRYPTO_ERR_VERIFY_FAILED;
  }

  /* Group check signature (as recommended by blst README) */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "signature group check failed" ));
    return TN_CRYPTO_ERR_VERIFY_FAILED;
  }

  /* Use blst core verify function */
  BLST_ERROR err = blst_core_verify_pk_in_g1(
      pubkey, signature, 1, (uchar const*)message, message_len,
      TN_CONSENSUS_DST, sizeof(TN_CONSENSUS_DST) - 1, NULL, 0);

  if (UNLIKELY(err != BLST_SUCCESS)) {
    FD_LOG_WARNING(( "blst_core_verify_pk_in_g1 failed: %d", (int)err ));
    return TN_CRYPTO_ERR_VERIFY_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_aggregate_signatures(tn_bls_signature_t* aggregate,
                                   tn_bls_signature_t const* sig1,
                                   tn_bls_signature_t const* sig2) {
  if (UNLIKELY(!aggregate || !sig1 || !sig2)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Convert to projective coordinates */
  blst_p2 p1, p2, result;
  blst_p2_from_affine(&p1, sig1);
  blst_p2_from_affine(&p2, sig2);

  /* Add the points */
  blst_p2_add(&result, &p1, &p2);

  /* Convert back to affine */
  blst_p2_to_affine(aggregate, &result);

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_aggregate_pubkeys(tn_bls_pubkey_t* aggregate,
                                tn_bls_pubkey_t const* pk1,
                                tn_bls_pubkey_t const* pk2) {
  if (UNLIKELY(!aggregate || !pk1 || !pk2)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Convert to projective coordinates */
  blst_p1 p1, p2, result;
  blst_p1_from_affine(&p1, pk1);
  blst_p1_from_affine(&p2, pk2);

  /* Add the points */
  blst_p1_add(&result, &p1, &p2);

  /* Convert back to affine */
  blst_p1_to_affine(aggregate, &result);

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_subtract_signature(tn_bls_signature_t* aggregate,
                                 tn_bls_signature_t const* to_subtract) {
  if (UNLIKELY(!aggregate || !to_subtract)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Convert to projective coordinates */
  blst_p2 agg, sub, result;
  blst_p2_from_affine(&agg, aggregate);
  blst_p2_from_affine(&sub, to_subtract);

  /* Negate the signature to subtract */
  blst_p2_cneg(&sub, 1);

  /* Add the negated signature (which is subtraction) */
  blst_p2_add(&result, &agg, &sub);

  /* Convert back to affine */
  blst_p2_to_affine(aggregate, &result);

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_subtract_pubkey(tn_bls_pubkey_t* aggregate,
                              tn_bls_pubkey_t const* to_subtract) {
  if (UNLIKELY(!aggregate || !to_subtract)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Convert to projective coordinates */
  blst_p1 agg, sub, result;
  blst_p1_from_affine(&agg, aggregate);
  blst_p1_from_affine(&sub, to_subtract);

  /* Negate the pubkey to subtract */
  blst_p1_cneg(&sub, 1);

  /* Add the negated pubkey (which is subtraction) */
  blst_p1_add(&result, &agg, &sub);

  /* Convert back to affine */
  blst_p1_to_affine(aggregate, &result);

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_verify_aggregate(tn_bls_signature_t const* aggregate_sig,
                               tn_bls_pubkey_t const* aggregate_pk,
                               void const* message, ulong message_len) {
  if (UNLIKELY(!aggregate_sig || !aggregate_pk || !message)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Group check public key (as recommended by blst README) */
  if( UNLIKELY( !blst_p1_affine_in_g1( aggregate_pk ) ) ) {
    FD_LOG_WARNING(( "aggregate public key group check failed" ));
    return TN_CRYPTO_ERR_VERIFY_FAILED;
  }

  /* Use blst core verify function for aggregate */
  BLST_ERROR err = blst_core_verify_pk_in_g1(
      aggregate_pk, aggregate_sig, 1, (uchar const*)message, message_len,
      TN_CONSENSUS_DST, sizeof(TN_CONSENSUS_DST) - 1, NULL, 0);

  if (UNLIKELY(err != BLST_SUCCESS)) {
    FD_LOG_WARNING(( "blst_core_verify_pk_in_g1 (aggregate) failed: %d", (int)err ));
    return TN_CRYPTO_ERR_VERIFY_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}

int tn_crypto_pubkey_on_curve(tn_bls_pubkey_t const* pubkey) {
  if (UNLIKELY(!pubkey)) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  if (UNLIKELY(!blst_p1_affine_on_curve(pubkey)) ||
      UNLIKELY(blst_p1_affine_is_inf(pubkey))) {
    return TN_CRYPTO_ERR_INVALID_PUBKEY;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_derive_pubkey( tn_bls_pubkey_t *             pubkey,
                         tn_bls_private_key_t const * private_key ) {
  if( UNLIKELY( !pubkey || !private_key ) ) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Generate corresponding public key from private key */
  blst_p1 pubkey_proj;
  blst_sk_to_pk_in_g1( &pubkey_proj, private_key );

  /* Convert to affine coordinates */
  blst_p1_to_affine( pubkey, &pubkey_proj );

  /* Group check public key */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "derived public key group check failed" ));
    return TN_CRYPTO_ERR_KEYGEN_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_serialize_pubkey( tn_bls_serialized_pubkey_t      serialized,
                            tn_bls_pubkey_t const *         pubkey ) {
  if( UNLIKELY( !serialized || !pubkey ) ) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Serialize affine point to uncompressed format (x + y coordinates) */
  blst_p1_affine_serialize( serialized, pubkey );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_deserialize_pubkey( tn_bls_pubkey_t *             pubkey,
                              tn_bls_serialized_pubkey_t const serialized ) {
  if( UNLIKELY( !pubkey || !serialized ) ) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Deserialize from uncompressed format directly to affine */
  BLST_ERROR err = blst_p1_deserialize( pubkey, serialized );
  if( UNLIKELY( err != BLST_SUCCESS ) ) {
    FD_LOG_WARNING(( "blst_p1_deserialize failed: %d (invalid uncompressed format)", (int)err ));
    return TN_CRYPTO_ERR_DESERIALIZE_FAILED;
  }

  /* Group check the deserialized public key */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "deserialized public key group check failed" ));
    return TN_CRYPTO_ERR_DESERIALIZE_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_serialize_signature( tn_bls_serialized_signature_t      serialized,
                               tn_bls_signature_t const *          signature ) {
  if( UNLIKELY( !serialized || !signature ) ) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Verify point is on curve before serializing */
  if( UNLIKELY( !blst_p2_affine_on_curve( signature ) ) ) {
    FD_LOG_WARNING(( "signature point not on curve before serialization" ));
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Serialize affine point to uncompressed format (x + y coordinates) */
  blst_p2_affine_serialize( serialized, signature );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_deserialize_signature( tn_bls_signature_t *              signature,
                                 tn_bls_serialized_signature_t const serialized ) {
  if( UNLIKELY( !signature || !serialized ) ) {
    return TN_CRYPTO_ERR_INVALID_PARAM;
  }

  /* Deserialize from uncompressed format directly to affine */
  BLST_ERROR err = blst_p2_deserialize( signature, serialized );
  if( UNLIKELY( err != BLST_SUCCESS ) ) {
    if( err == BLST_POINT_NOT_ON_CURVE ) {
      FD_LOG_WARNING(( "blst_p2_deserialize failed: %d (point not on curve)", (int)err ));
    } else if( err == BLST_BAD_ENCODING ) {
      FD_LOG_WARNING(( "blst_p2_deserialize failed: %d (bad encoding)", (int)err ));
    } else {
      FD_LOG_WARNING(( "blst_p2_deserialize failed: %d", (int)err ));
    }
    return TN_CRYPTO_ERR_DESERIALIZE_FAILED;
  }

  /* Signatures are group-checked internally by blst during verification,
     but we can also check here for early validation */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "deserialized signature group check failed" ));
    return TN_CRYPTO_ERR_DESERIALIZE_FAILED;
  }

  return TN_CRYPTO_SUCCESS;
}
