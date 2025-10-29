/* Polyfill XMLHttpRequest for Node.js */
import { createClient } from "@connectrpc/connect";

import { createGrpcWebTransport } from "@connectrpc/connect-web";
import { GetHeightRequestSchema, QueryService } from '../proto/thru/services/v1/query_service_pb';

import { create } from "@bufbuild/protobuf";

/* Example script to get the current block height from a Thru node */
async function getBlockHeight(hostUrl: string): Promise<void> {
  /* Create the gRPC client */
  const transport = createGrpcWebTransport({
    baseUrl: hostUrl,
  });
  const client = createClient(QueryService, transport);


  try {
    /* Create an empty request */
    const request = create(GetHeightRequestSchema);

    /* Call the GetHeight RPC method */
    const response = await client.getHeight(request);

    /* Extract height information from the response */
    const finalized = response.finalized;
    const locallyExecuted = response.locallyExecuted;
    const clusterExecuted = response.clusterExecuted;

    /* Display the results */
    console.log('=== Block Height ===');
    console.log(`Finalized:        ${finalized}`);
    console.log(`Locally Executed: ${locallyExecuted}`);
    console.log(`Cluster Executed: ${clusterExecuted}`);
  } catch (err) {
    console.error('Error fetching block height:', err);
    throw err;
  }
}

/* Main execution */
const DEFAULT_HOST = "https://grpc-web.alphanet.thruput.org";

console.log(`Connecting to Thru node at ${DEFAULT_HOST}...`);

getBlockHeight(DEFAULT_HOST)
  .then(() => {
    console.log('\nSuccess!');
  })
  .catch((err) => {
    console.error('\nFailed to get block height:', err);
  });
