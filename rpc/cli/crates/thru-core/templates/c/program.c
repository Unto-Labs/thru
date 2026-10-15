/* {{PROJECT_NAME}} - Thru Program
 * A simple hello world program for the Thru blockchain
 */

#include <thru-sdk/c/tn_sdk.h>

TSDK_ENTRYPOINT_FN void
start( void ) {
  /* Read the instruction context from the transaction, not entry registers. */
  tsdk_txn_t const * txn = tsdk_get_txn();
  uchar const * instruction_data    TSDK_PARAM_UNUSED = tsdk_txn_get_instr_data( txn );
  ulong         instruction_data_sz TSDK_PARAM_UNUSED = tsdk_txn_get_instr_data_sz( txn );

  tsdk_return( 0UL );
}
