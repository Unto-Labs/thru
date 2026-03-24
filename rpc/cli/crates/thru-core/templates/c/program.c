/* {{PROJECT_NAME}} - Thru Program
 * A simple hello world program for the Thru blockchain
 */

#include <thru-sdk/c/tn_sdk.h>

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data    TSDK_PARAM_UNUSED,
       ulong        instruction_data_sz TSDK_PARAM_UNUSED ) {
  tsdk_return( 0UL );
}
