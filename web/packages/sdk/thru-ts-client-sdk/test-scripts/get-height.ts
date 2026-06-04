import { createThruClient } from "../client";
import { DEFAULT_HOST } from "../defaults";
import { PageRequest } from "../sdk";

const thru = createThruClient({
  baseUrl: DEFAULT_HOST,
});

const transaction = await thru.transactions.listForAccount("taLNrGlb3VsLLXIlT61QtUwVsrI7M5432DxpJRBfY1tOF3", {
  page: new PageRequest({
    pageSize: 1,
  }),
});
console.log(transaction);
