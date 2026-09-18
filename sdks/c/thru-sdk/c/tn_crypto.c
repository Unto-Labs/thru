#include "tn_crypto.h"

/* Domain separation tag for consensus signatures */
static uchar const TN_CONSENSUS_DST[] = "TN_CONSENSUS_V1";

// WARNING: THIS IS NOT SECURE PLEASE DO NOT USE THIS OUTSIDE OF TESTING CODE
int
tn_crypto_generate_keypair( tn_bls_pubkey_t * pubkey,
                            tn_bls_private_key_t * private_key, ulong seed ) {
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_KEYPAIR_PUBKEY_IS_NULL;
  if( UNLIKELY( !private_key ) ) return TN_CRYPTO_ERR_KEYPAIR_PRIVATE_KEY_IS_NULL;

  /* Create deterministic key material from seed */
  uchar ikm[32];
  for( ulong i = 0; i < 32; i++ ) {
    ikm[i] = (uchar)(( seed >> ( i % 8 )) ^ ( i * 37 ));
  }

  /* Generate BLS private key using proper key derivation */
  blst_keygen( private_key, ikm, sizeof( ikm ), NULL, 0 );

  /* Generate corresponding public key */
  blst_p1 pubkey_proj;
  blst_sk_to_pk_in_g1( &pubkey_proj, private_key );

  /* Convert to affine coordinates */
  blst_p1_to_affine( pubkey, &pubkey_proj );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_sign_message_with_dst( tn_bls_signature_t *         signature,
                                 void const *                 message,
                                 ulong                        message_len,
                                 tn_bls_private_key_t const * private_key,
                                 uchar const *                dst,
                                 ulong                        dst_len ) {
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_SIGN_SIGNATURE_IS_NULL;
  if( UNLIKELY( !message ) ) return TN_CRYPTO_ERR_SIGN_MESSAGE_IS_NULL;
  if( UNLIKELY( !private_key ) ) return TN_CRYPTO_ERR_SIGN_PRIVATE_KEY_IS_NULL;
  if( UNLIKELY( !dst ) ) return TN_CRYPTO_ERR_SIGN_DST_IS_NULL;

  /* Hash message to G2 point */
  blst_p2 hash_point;
  blst_hash_to_g2( &hash_point, (uchar const *)message, message_len,
                  dst, dst_len, NULL, 0 );

  /* Sign by multiplying hash point by private key */
  blst_p2 sig_proj;
  blst_sign_pk_in_g1( &sig_proj, &hash_point, private_key );

  /* Convert to affine coordinates */
  blst_p2_to_affine( signature, &sig_proj );

  /* Group check signature (as recommended by blst README) */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "signature group check failed after signing" ));
    return TN_CRYPTO_ERR_SIGN_SIGNATURE_NOT_IN_G2;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_sign_message( tn_bls_signature_t * signature, void const * message,
                        ulong message_len,
                        tn_bls_private_key_t const * private_key ) {
  return tn_crypto_sign_message_with_dst( signature, message, message_len,
      private_key, TN_CONSENSUS_DST, sizeof( TN_CONSENSUS_DST ) - 1 );
}

/* tn_crypto_pairing_check tests e(pubkey, H(message)) == e(G1, signature).

   On the host this is one 2-term Miller loop and a single final
   exponentiation.  The formulation it replaces -- blst_aggregated_in_g2 to
   precompute the signature side, then a blst_pairing context for the
   public-key side -- drives the two Miller loops separately and does strictly
   more work for the same answer; folding both terms into blst_miller_loop_n is
   what upstream Firedancer's Alpenglow BLS code does, and is worth ~78 us per
   verification.

   On-chain builds keep the older formulation for a stack reason; see the
   THRU_VM branch.

   Returns 1 if the pairing check holds, 0 otherwise.  Callers are responsible
   for the subgroup checks; this does no validation. */
static int
tn_crypto_pairing_check( tn_bls_signature_t const * signature,
                         tn_bls_pubkey_t const *    pubkey,
                         void const *               message,
                         ulong                      message_len,
                         uchar const *              dst,
                         ulong                      dst_len ) {
  /* Reject the group identity explicitly, on both targets.

     A subgroup check admits the identity -- it is a member of the subgroup --
     so neither blst_p1_affine_in_g1 nor a deserializer screens it out, and the
     compressed encoding for it is reachable on the wire.  The identity must
     not verify: e(O,H(m)) * e(G1,O) is the identity of GT, so an all-identity
     certificate would otherwise satisfy the pairing equation for any message.

     The host path already fails such an input today, but only by accident:
     blst represents affine infinity as (0,0), so the line evaluations collapse
     and blst_miller_loop_n returns a zero Fp12 rather than one, which
     finalverify rejects.  That is blst being loose, not a guarantee -- the
     mathematically correct value of e(O,Q) *is* one, so a blst release that
     handled infinity properly would silently turn this into an accept.  The
     on-chain path rejects it for a real reason (blst_pairing_aggregate_pk_in_g1
     returns BLST_PK_IS_INFINITY), and this guard makes both targets reject it
     by intent and keeps them in agreement. */
  if( UNLIKELY( blst_p1_affine_is_inf( pubkey ) ) ) return 0;
  if( UNLIKELY( blst_p2_affine_is_inf( signature ) ) ) return 0;

#ifdef THRU_VM
  /* On-chain builds keep the incremental blst_pairing formulation.

     blst_miller_loop_n is the faster form on the host, but in blst's portable
     RISC-V build the public wrapper reserves roughly 9.9 KiB of stack -- a
     1744-byte frame plus a fixed 8 KiB scratch allocation -- where the
     blst_pairing path uses about 2.4 KiB (a 640-byte frame, the ~1.5 KiB
     alloca'd context, and 48-224 byte callee frames, which reach blst's
     internal 144-byte miller_loop_n rather than the public wrapper).  That
     overruns an on-chain program's stack budget and faults the VM with
     TN_VM_ERR_SIGSEGV.  On-chain verification is not the throughput-critical
     path, so the cheaper formulation stays here. */
  blst_fp12 gtsig;
  blst_aggregated_in_g2( &gtsig, signature );

  blst_pairing * pairing = (blst_pairing *)__builtin_alloca( blst_pairing_sizeof() );
  blst_pairing_init( pairing, 1, dst, dst_len );

  if( UNLIKELY( blst_pairing_aggregate_pk_in_g1( pairing, pubkey, NULL,
                                                 (uchar const *)message,
                                                 message_len, NULL, 0 )
                != BLST_SUCCESS ) ) return 0;

  blst_pairing_commit( pairing );

  return !!blst_pairing_finalverify( pairing, &gtsig );
#else
  blst_p2        hash_proj;
  blst_p2_affine hash_affine;
  blst_hash_to_g2( &hash_proj, (uchar const *)message, message_len,
                   dst, dst_len, NULL, 0 );

  /* Negate the hash rather than using blst's BLS12_381_NEG_G1 global.  Both
     express the same check -- e(pk,-H(m))*e(G1,sig) == 1 is e(pk,H(m)) == e(G1,sig)
     -- and negating here is free, since the point is still projective, so cneg
     is a field negation with no inversion. */
  blst_p2_cneg( &hash_proj, 1 );
  blst_p2_to_affine( &hash_affine, &hash_proj );

  blst_p1_affine const * g1_terms[2] = { pubkey, blst_p1_affine_generator() };
  blst_p2_affine const * g2_terms[2] = { &hash_affine, signature };

  blst_fp12 acc;
  blst_miller_loop_n( &acc, g2_terms, g1_terms, 2 );

  return !!blst_fp12_finalverify( &acc, blst_fp12_one() );
#endif
}

int
tn_crypto_verify_signature( tn_bls_signature_t const * signature,
                            tn_bls_pubkey_t const * pubkey,
                            void const * message, ulong message_len ) {
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_VERIFY_SIGNATURE_IS_NULL;
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_VERIFY_PUBKEY_IS_NULL;
  if( UNLIKELY( !message ) ) return TN_CRYPTO_ERR_VERIFY_MESSAGE_IS_NULL;

  /* Group check public key (as recommended by blst README) */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "public key group check failed" ));
    return TN_CRYPTO_ERR_VERIFY_PUBKEY_NOT_IN_G1;
  }

  /* The pairing API lets us precompute the signature side once and then
     verify the public-key/message side against it. */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "signature group check failed" ));
    return TN_CRYPTO_ERR_VERIFY_SIGNATURE_NOT_IN_G2;
  }

  if( UNLIKELY( !tn_crypto_pairing_check( signature, pubkey, message, message_len,
                                          TN_CONSENSUS_DST,
                                          sizeof( TN_CONSENSUS_DST ) - 1 ) ) ) {
    FD_LOG_WARNING(( "signature pairing check failed" ));
    return TN_CRYPTO_ERR_VERIFY_PAIRING_MISMATCH;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_verify_signature_prechecked( tn_bls_signature_t const * signature,
                                       tn_bls_pubkey_t const *    pubkey,
                                       void const *               message,
                                       ulong                      message_len ) {
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_VERIFY_SIGNATURE_IS_NULL;
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_VERIFY_PUBKEY_IS_NULL;
  if( UNLIKELY( !message ) ) return TN_CRYPTO_ERR_VERIFY_MESSAGE_IS_NULL;

  /* No subgroup checks here by contract; see the header. */
  if( UNLIKELY( !tn_crypto_pairing_check( signature, pubkey, message, message_len,
                                          TN_CONSENSUS_DST,
                                          sizeof( TN_CONSENSUS_DST ) - 1 ) ) ) {
    FD_LOG_WARNING(( "signature pairing check failed (prechecked)" ));
    return TN_CRYPTO_ERR_VERIFY_PAIRING_MISMATCH;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_aggregate_signatures( tn_bls_signature_t *       aggregate,
                                tn_bls_signature_t const * sig1,
                                tn_bls_signature_t const * sig2 ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_AGG_SIGNATURE_OUTPUT_IS_NULL;
  if( UNLIKELY( !sig1 ) ) return TN_CRYPTO_ERR_AGG_SIGNATURE_LEFT_IS_NULL;
  if( UNLIKELY( !sig2 ) ) return TN_CRYPTO_ERR_AGG_SIGNATURE_RIGHT_IS_NULL;

  blst_p2 result;
  blst_p2_from_affine( &result, sig1 );
  blst_p2_add_or_double_affine( &result, &result, sig2 );

  /* Convert back to affine */
  blst_p2_to_affine( aggregate, &result );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_aggregate_pubkeys( tn_bls_pubkey_t *       aggregate,
                             tn_bls_pubkey_t const * pk1,
                             tn_bls_pubkey_t const * pk2 ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_AGG_PUBKEY_OUTPUT_IS_NULL;
  if( UNLIKELY( !pk1 ) ) return TN_CRYPTO_ERR_AGG_PUBKEY_LEFT_IS_NULL;
  if( UNLIKELY( !pk2 ) ) return TN_CRYPTO_ERR_AGG_PUBKEY_RIGHT_IS_NULL;

  blst_p1 result;
  blst_p1_from_affine( &result, pk1 );
  blst_p1_add_or_double_affine( &result, &result, pk2 );

  /* Convert back to affine */
  blst_p1_to_affine( aggregate, &result );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_pubkey_acc_init( tn_bls_pubkey_acc_t *   acc,
                           tn_bls_pubkey_t const * pubkey ) {
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_ACC_IS_NULL;
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_PUBKEY_IS_NULL;

  blst_p1_from_affine( acc, pubkey );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_pubkey_acc_add( tn_bls_pubkey_acc_t *   acc,
                          tn_bls_pubkey_t const * pubkey ) {
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_ACC_IS_NULL;
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_PUBKEY_IS_NULL;

  blst_p1_add_or_double_affine( acc, acc, pubkey );

  return TN_CRYPTO_SUCCESS;
}

#ifndef THRU_VM
/* seed_acc != 0 initialises the accumulator from this batch instead of adding to
   it, so a caller folding several batches seeds with the first and adds the
   rest without needing a separate identity representation.

   Host-only: blst_p1s_add allocas up to min(cnt,1024)*sizeof(blst_p1) of
   scratch -- 36.8 KiB at TN_CRYPTO_PUBKEY_BATCH_MAX -- which is fine on a tile
   stack and far too much for an on-chain program.  No on-chain code folds
   validator sets, so this simply does not exist in ThruVM builds. */
int
tn_crypto_pubkey_acc_add_batch( tn_bls_pubkey_acc_t *   acc,
                                tn_bls_pubkey_t const * pubkeys,
                                ulong                   cnt,
                                int                     seed_acc ) {
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_ACC_IS_NULL;
  if( UNLIKELY( !pubkeys ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_PUBKEY_IS_NULL;
  if( UNLIKELY( !cnt || cnt > TN_CRYPTO_PUBKEY_BATCH_MAX ) ) {
    return TN_CRYPTO_ERR_PUBKEY_ACC_BATCH_COUNT;
  }

  /* blst walks a NULL entry as "continue contiguously from the previous
     point", so a two-element list is how a plain array is passed. */
  tn_bls_pubkey_t const * points[2] = { pubkeys, NULL };

  blst_p1 partial;
  blst_p1s_add( &partial, points, cnt );

  if( seed_acc ) *acc = partial;
  else           blst_p1_add( acc, acc, &partial );

  return TN_CRYPTO_SUCCESS;
}
#endif /* THRU_VM */

int
tn_crypto_pubkey_acc_fini( tn_bls_pubkey_t *           aggregate,
                           tn_bls_pubkey_acc_t const * acc ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_OUTPUT_IS_NULL;
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_PUBKEY_ACC_ACC_IS_NULL;

  blst_p1_to_affine( aggregate, acc );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_signature_acc_init( tn_bls_signature_acc_t *   acc,
                              tn_bls_signature_t const * signature ) {
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_ACC_IS_NULL;
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_SIGNATURE_IS_NULL;

  blst_p2_from_affine( acc, signature );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_signature_acc_add( tn_bls_signature_acc_t *   acc,
                             tn_bls_signature_t const * signature ) {
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_ACC_IS_NULL;
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_SIGNATURE_IS_NULL;

  blst_p2_add_or_double_affine( acc, acc, signature );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_signature_acc_fini( tn_bls_signature_t *           aggregate,
                              tn_bls_signature_acc_t const * acc ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_OUTPUT_IS_NULL;
  if( UNLIKELY( !acc ) ) return TN_CRYPTO_ERR_SIGNATURE_ACC_ACC_IS_NULL;

  blst_p2_to_affine( aggregate, acc );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_subtract_signature( tn_bls_signature_t *       aggregate,
                              tn_bls_signature_t const * to_subtract ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_SUB_SIGNATURE_AGGREGATE_IS_NULL;
  if( UNLIKELY( !to_subtract ) ) return TN_CRYPTO_ERR_SUB_SIGNATURE_SUBTRAHEND_IS_NULL;

  /* Convert to projective coordinates */
  blst_p2 agg, sub, result;
  blst_p2_from_affine( &agg, aggregate );
  blst_p2_from_affine( &sub, to_subtract );

  /* Negate the signature to subtract */
  blst_p2_cneg( &sub, 1 );

  /* Add the negated signature (which is subtraction) */
  blst_p2_add( &result, &agg, &sub );

  /* Convert back to affine */
  blst_p2_to_affine( aggregate, &result );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_subtract_pubkey( tn_bls_pubkey_t *       aggregate,
                           tn_bls_pubkey_t const * to_subtract ) {
  if( UNLIKELY( !aggregate ) ) return TN_CRYPTO_ERR_SUB_PUBKEY_AGGREGATE_IS_NULL;
  if( UNLIKELY( !to_subtract ) ) return TN_CRYPTO_ERR_SUB_PUBKEY_SUBTRAHEND_IS_NULL;

  /* Convert to projective coordinates */
  blst_p1 agg, sub, result;
  blst_p1_from_affine( &agg, aggregate );
  blst_p1_from_affine( &sub, to_subtract );

  /* Negate the pubkey to subtract */
  blst_p1_cneg( &sub, 1 );

  /* Add the negated pubkey (which is subtraction) */
  blst_p1_add( &result, &agg, &sub );

  /* Convert back to affine */
  blst_p1_to_affine( aggregate, &result );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_verify_aggregate_with_dst( tn_bls_signature_t const * aggregate_sig,
                                     tn_bls_pubkey_t const *    aggregate_pk,
                                     void const *               message,
                                     ulong                      message_len,
                                     uchar const *              dst,
                                     ulong                      dst_len ) {
  if( UNLIKELY( !aggregate_sig ) ) return TN_CRYPTO_ERR_AGG_VERIFY_SIGNATURE_IS_NULL;
  if( UNLIKELY( !aggregate_pk ) ) return TN_CRYPTO_ERR_AGG_VERIFY_PUBKEY_IS_NULL;
  if( UNLIKELY( !message ) ) return TN_CRYPTO_ERR_AGG_VERIFY_MESSAGE_IS_NULL;
  if( UNLIKELY( !dst ) ) return TN_CRYPTO_ERR_AGG_VERIFY_DST_IS_NULL;

  /* Group check public key (as recommended by blst README) */
  if( UNLIKELY( !blst_p1_affine_in_g1( aggregate_pk ) ) ) {
    FD_LOG_WARNING(( "aggregate public key group check failed" ));
    return TN_CRYPTO_ERR_AGG_VERIFY_PUBKEY_NOT_IN_G1;
  }

  if( UNLIKELY( !blst_p2_affine_in_g2( aggregate_sig ) ) ) {
    FD_LOG_WARNING(( "aggregate signature group check failed" ));
    return TN_CRYPTO_ERR_AGG_VERIFY_SIGNATURE_NOT_IN_G2;
  }

  if( UNLIKELY( !tn_crypto_pairing_check( aggregate_sig, aggregate_pk, message,
                                          message_len, dst, dst_len ) ) ) {
    FD_LOG_WARNING(( "aggregate pairing check failed" ));
    return TN_CRYPTO_ERR_AGG_VERIFY_PAIRING_MISMATCH;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_verify_aggregate_prechecked( tn_bls_signature_t const * aggregate_sig,
                                       tn_bls_pubkey_t const *    aggregate_pk,
                                       void const *               message,
                                       ulong                      message_len ) {
  if( UNLIKELY( !aggregate_sig ) ) return TN_CRYPTO_ERR_AGG_VERIFY_SIGNATURE_IS_NULL;
  if( UNLIKELY( !aggregate_pk ) ) return TN_CRYPTO_ERR_AGG_VERIFY_PUBKEY_IS_NULL;
  if( UNLIKELY( !message ) ) return TN_CRYPTO_ERR_AGG_VERIFY_MESSAGE_IS_NULL;

  /* No subgroup checks here by contract; see the header. */
  if( UNLIKELY( !tn_crypto_pairing_check( aggregate_sig, aggregate_pk, message,
                                          message_len, TN_CONSENSUS_DST,
                                          sizeof( TN_CONSENSUS_DST ) - 1 ) ) ) {
    FD_LOG_WARNING(( "aggregate pairing check failed (prechecked)" ));
    return TN_CRYPTO_ERR_AGG_VERIFY_PAIRING_MISMATCH;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_verify_aggregate( tn_bls_signature_t const * aggregate_sig,
                            tn_bls_pubkey_t const *    aggregate_pk,
                            void const *               message,
                            ulong                      message_len ) {
  return tn_crypto_verify_aggregate_with_dst( aggregate_sig, aggregate_pk,
      message, message_len,
      TN_CONSENSUS_DST, sizeof( TN_CONSENSUS_DST ) - 1 );
}

int
tn_crypto_pubkey_on_curve( tn_bls_pubkey_t const * pubkey ) {
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_PUBKEY_CURVE_PUBKEY_IS_NULL;
  if( UNLIKELY( !blst_p1_affine_on_curve( pubkey ) ) ) {
    return TN_CRYPTO_ERR_PUBKEY_NOT_ON_CURVE;
  }
  if( UNLIKELY( blst_p1_affine_is_inf( pubkey ) ) ) {
    return TN_CRYPTO_ERR_PUBKEY_IS_INFINITY;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_derive_pubkey( tn_bls_pubkey_t *            pubkey,
                         tn_bls_private_key_t const * private_key ) {
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_DERIVE_PUBKEY_OUTPUT_IS_NULL;
  if( UNLIKELY( !private_key ) ) return TN_CRYPTO_ERR_DERIVE_PUBKEY_PRIVATE_KEY_IS_NULL;

  /* Generate corresponding public key from private key */
  blst_p1 pubkey_proj;
  blst_sk_to_pk_in_g1( &pubkey_proj, private_key );

  /* Convert to affine coordinates */
  blst_p1_to_affine( pubkey, &pubkey_proj );

  /* Group check public key */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "derived public key group check failed" ));
    return TN_CRYPTO_ERR_DERIVE_PUBKEY_NOT_IN_G1;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_serialize_pubkey( tn_bls_serialized_pubkey_t      serialized,
                            tn_bls_pubkey_t const *         pubkey ) {
  if( UNLIKELY( !serialized ) ) return TN_CRYPTO_ERR_SERIALIZE_PUBKEY_OUTPUT_IS_NULL;
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_SERIALIZE_PUBKEY_IS_NULL;

  /* Serialize affine point to uncompressed format (x + y coordinates) */
  blst_p1_affine_serialize( serialized, pubkey );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_deserialize_pubkey( tn_bls_pubkey_t *                pubkey,
                              tn_bls_serialized_pubkey_t const serialized ) {
  if( UNLIKELY( !pubkey ) ) return TN_CRYPTO_ERR_DESERIALIZE_PUBKEY_OUTPUT_IS_NULL;
  if( UNLIKELY( !serialized ) ) return TN_CRYPTO_ERR_DESERIALIZE_PUBKEY_BYTES_IS_NULL;

  /* Deserialize from uncompressed format directly to affine */
  BLST_ERROR err = blst_p1_deserialize( pubkey, serialized );
  if( UNLIKELY( err != BLST_SUCCESS ) ) {
    FD_LOG_WARNING(( "blst_p1_deserialize failed: %d (invalid uncompressed format)", (int)err ));
    return TN_CRYPTO_ERR_DESERIALIZE_PUBKEY_ENCODING_REJECTED;
  }

  /* Group check the deserialized public key */
  if( UNLIKELY( !blst_p1_affine_in_g1( pubkey ) ) ) {
    FD_LOG_WARNING(( "deserialized public key group check failed" ));
    return TN_CRYPTO_ERR_DESERIALIZE_PUBKEY_NOT_IN_G1;
  }

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_serialize_signature( tn_bls_serialized_signature_t      serialized,
                               tn_bls_signature_t const *         signature ) {
  if( UNLIKELY( !serialized ) ) return TN_CRYPTO_ERR_SERIALIZE_SIGNATURE_OUTPUT_IS_NULL;
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_SERIALIZE_SIGNATURE_IS_NULL;

  /* Verify point is on curve before serializing */
  if( UNLIKELY( !blst_p2_affine_on_curve( signature ) ) ) {
    FD_LOG_WARNING(( "signature point not on curve before serialization" ));
    return TN_CRYPTO_ERR_SERIALIZE_SIGNATURE_NOT_ON_CURVE;
  }

  /* Serialize affine point to uncompressed format (x + y coordinates) */
  blst_p2_affine_serialize( serialized, signature );

  return TN_CRYPTO_SUCCESS;
}

int
tn_crypto_deserialize_signature( tn_bls_signature_t *                signature,
                                 tn_bls_serialized_signature_t const serialized ) {
  if( UNLIKELY( !signature ) ) return TN_CRYPTO_ERR_DESERIALIZE_SIGNATURE_OUTPUT_IS_NULL;
  if( UNLIKELY( !serialized ) ) return TN_CRYPTO_ERR_DESERIALIZE_SIGNATURE_BYTES_IS_NULL;

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
    return TN_CRYPTO_ERR_DESERIALIZE_SIGNATURE_ENCODING_REJECTED;
  }

  /* Signatures are group-checked internally by blst during verification,
     but we can also check here for early validation */
  if( UNLIKELY( !blst_p2_affine_in_g2( signature ) ) ) {
    FD_LOG_WARNING(( "deserialized signature group check failed" ));
    return TN_CRYPTO_ERR_DESERIALIZE_SIGNATURE_NOT_IN_G2;
  }

  return TN_CRYPTO_SUCCESS;
}
