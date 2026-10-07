import { Fragment, createElement, type ReactNode } from "react";
import { t, type MessageKey } from "./index.ts";

/**
 * `t` for text with elements inside, e.g. "See {link} for details" with
 * `{ link: <a href=…>{t("x.linkText")}</a> }`. The translation decides where
 * each element lands, so word order can differ between languages.
 */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode {
  const parts = t(key).split(/(\{\w+\})/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name !== undefined && name in nodes ? nodes[name] : part;
    }),
  );
}
