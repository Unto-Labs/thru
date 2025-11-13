import { createThruClient } from "../client";

const thru = createThruClient({
  baseUrl: "https://grpc-web.alphanet.thruput.org",
});

const transaction = await thru.transactions.get("ts3TQtscybPcD1keVEkaWAa4rZSa70K0knukd75uti-k26T5CscJnNobK9d48o3dHIvTkLqLjnnmuK_WJx-yNEBCPi");
console.log(transaction.executionResult?.events);