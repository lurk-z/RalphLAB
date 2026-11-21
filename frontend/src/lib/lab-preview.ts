import { loginEnabled } from "./login-mode";

export const localLabPreview =
  !loginEnabled && process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_LAB_PREVIEW === "1";
