/* Host regression test for the C project template. No node or keys required. */
#include <thru-sdk/c/tn_sdk.h>
#include <stdio.h>
#include <stdlib.h>

/* The VM's ELF section name is not a host Mach-O section name. */
#undef TSDK_ENTRYPOINT_FN
#define TSDK_ENTRYPOINT_FN __attribute__((noreturn))

static tsdk_txn_t * test_txn;
static uchar const * expected_data;
static ulong expected_size;
static uint txn_reads;
static uint data_reads;
static uint size_reads;

static tsdk_txn_t const *
test_get_txn( void ) {
  txn_reads++;
  return test_txn;
}

static uchar const *
test_get_instr_data( tsdk_txn_t const * txn ) {
  uchar const * data = tsdk_txn_get_instr_data( txn );
  if( txn!=test_txn || data!=expected_data ) exit( 1 );
  data_reads++;
  return data;
}

static ushort
test_get_instr_data_sz( tsdk_txn_t const * txn ) {
  ushort size = tsdk_txn_get_instr_data_sz( txn );
  if( txn!=test_txn || (ulong)size!=expected_size ) exit( 1 );
  size_reads++;
  return size;
}

/* A prototype makes a scaffold that expects register arguments fail to compile.
   Wrap only the transaction accessors; their implementations remain the SDK's. */
TSDK_ENTRYPOINT_FN void test_start( void );
#define start test_start
#define tsdk_get_txn test_get_txn
#define tsdk_txn_get_instr_data test_get_instr_data
#define tsdk_txn_get_instr_data_sz test_get_instr_data_sz
#include THRU_C_PROGRAM_TEMPLATE
#undef tsdk_txn_get_instr_data_sz
#undef tsdk_txn_get_instr_data
#undef tsdk_get_txn
#undef start

void
tsdk_return( ulong return_code ) {
  int ok = return_code==TSDK_SUCCESS && txn_reads==1U &&
           data_reads==1U && size_reads==1U;
  free( test_txn );
  if( !ok ) fprintf( stderr, "Template did not read instruction context from the transaction\n" );
  exit( ok ? 0 : 1 );
}

int
main( int argc, char ** argv ) {
  if( argc!=3 ) return 1;
  expected_size = strtoul( argv[1], NULL, 10 );
  ulong account_cnt = strtoul( argv[2], NULL, 10 );
  if( expected_size>65535UL || account_cnt>8UL ) return 1;

  ulong data_offset = sizeof( tsdk_txn_hdr_v1_t ) + account_cnt*sizeof( tn_pubkey_t );
  test_txn = calloc( 1UL, data_offset + expected_size );
  if( !test_txn ) return 1;
  test_txn->hdr.v1.transaction_version = 1U;
  test_txn->hdr.v1.instr_data_sz = (ushort)expected_size;
  test_txn->hdr.v1.readwrite_accounts_cnt = (ushort)(account_cnt/2UL);
  test_txn->hdr.v1.readonly_accounts_cnt = (ushort)(account_cnt-account_cnt/2UL);
  expected_data = (uchar const *)test_txn + data_offset;

  test_start();
}
