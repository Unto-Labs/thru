/* {{PROJECT_NAME}} - Thru Program
 * A simple hello world program for the Thru blockchain
 */

/* This program owns no accounts. If you add one, start its packed struct
   with `uchar account_type`: one value per account layout, starting at 1
   (0 is invalid). A changed layout takes the next unused value, never a
   reused one. Write the byte when you create the account and check the
   owner and the byte on every load (tsdk_account_is in tn_sdk_account.h).
   See https://thru.org/docs/abi/authoring-guide/#program-accounts */

#include <thru-sdk/c/tn_sdk.h>

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data    TSDK_PARAM_UNUSED,
       ulong        instruction_data_sz TSDK_PARAM_UNUSED ) {
  tsdk_return( 0UL );
}
