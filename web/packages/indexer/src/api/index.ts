/**
 * API module exports.
 */

// Route generation
export { mountStreamRoutes, type MountRoutesOptions } from "./routes";

// Schema generation
export { generateSchemas, type GeneratedSchemas } from "./schemas";

// Pagination utilities
export {
  paginationQuerySchema,
  paginationResponseSchema,
  dataResponse,
  listResponse,
  errorSchema,
  paginate,
  parseCursor,
  type PaginationQuery,
  type PaginationResponse,
  type PaginationResult,
  type ErrorResponse,
} from "./pagination";
