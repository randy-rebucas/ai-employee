declare module "*.css";

// @shopify/app-bridge-types only augments the deprecated global `JSX`
// namespace, but this project's `jsx: "react-jsx"` + modern @types/react
// resolve intrinsic elements through `declare module "react" { namespace JSX
// ... }` instead (the same pattern @shopify/polaris-types uses, which is why
// every other `s-*` element already works). Re-declare the one element that
// falls through that gap here, reusing app-bridge-types' real prop shape.
import type { SAppNavAttributes } from "@shopify/app-bridge-types";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavAttributes & { children?: React.ReactNode };
    }
  }
}
