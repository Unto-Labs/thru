import { createThruClient } from "../client";
import { PageRequest } from "../sdk";

const thru = createThruClient({
  baseUrl: "https://grpc-web.alphanet.thruput.org",
});

const transaction = await thru.transactions.listForAccount("taLNrGlb3VsLLXIlT61QtUwVsrI7M5432DxpJRBfY1tOF3", {
  page: new PageRequest({
    pageSize: 1,
  }),
});
console.log(transaction);