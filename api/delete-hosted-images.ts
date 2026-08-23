import { postJsonHandler } from "../server/lib/http.js";
import { deleteHostedImages } from "../server/deleteHostedImages.js";

export default postJsonHandler(
  (body) => deleteHostedImages(body.urls),
  (message) => (message.includes("BLOB_READ_WRITE_TOKEN") ? 500 : 400),
);
