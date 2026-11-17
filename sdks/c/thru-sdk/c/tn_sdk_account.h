#ifndef HEADER_tn_sdks_c_thru_sdk_c_tn_sdk_account_h
#define HEADER_tn_sdks_c_thru_sdk_c_tn_sdk_account_h

#include "tn_sdk_base.h"

/* Account discriminator convention.

   This is a convention, not a requirement: programs are strongly
   encouraged to follow it, but the runtime does not enforce it. A program
   that follows it starts each structured account it owns with a one-byte
   discriminator: one value per (account kind, layout) pair, per program,
   starting at 1. The payload follows immediately (accounts are packed).

   - 0 is invalid, so a zeroed or closed account never decodes.
   - A layout is never edited in place. A changed layout of an existing
     kind, and a new kind of account, both take the next unused value.
     Retired values are never reused. Giving meaning to a reserved byte is
     an edit.
   - Nothing else (a magic number, an in-payload version field, the
     account size or a program hash) selects a layout.

   Program code accounts and Uploader source buffers hold opaque bytes and
   are exempt. Accounts with no data hold only a balance and stay empty.

   A program following it defines its values as
   TN_<PROGRAM>_ACCOUNT_TYPE_<KIND>_V<N> and puts `uchar account_type` first
   in each packed account struct. */

#define TSDK_ACCOUNT_TYPE_INVALID ((uchar)0U)
#define TSDK_ACCOUNT_TYPE_SZ      (1UL)

/* tsdk_account_type returns the discriminator of account data, or
   TSDK_ACCOUNT_TYPE_INVALID if the account has no data. */

static inline uchar
tsdk_account_type( uchar const * data,
                   ulong         data_sz ) {
  return data_sz ? data[0] : TSDK_ACCOUNT_TYPE_INVALID;
}

/* tsdk_account_is returns 1 if data is exactly data_sz_expected bytes and
   starts with the discriminator expected, and 0 otherwise. Use it for
   fixed-size layouts. */

static inline int
tsdk_account_is( uchar const * data,
                 ulong         data_sz,
                 uchar         expected,
                 ulong         data_sz_expected ) {
  return ( data_sz == data_sz_expected ) & ( tsdk_account_type( data, data_sz ) == expected );
}

/* tsdk_account_is_at_least returns 1 if data is at least data_sz_min bytes
   and starts with the discriminator expected, and 0 otherwise. Use it for
   variable-size layouts, then validate the variable part. */

static inline int
tsdk_account_is_at_least( uchar const * data,
                          ulong         data_sz,
                          uchar         expected,
                          ulong         data_sz_min ) {
  return ( data_sz >= data_sz_min ) & ( tsdk_account_type( data, data_sz ) == expected );
}

#endif /* HEADER_tn_sdks_c_thru_sdk_c_tn_sdk_account_h */

