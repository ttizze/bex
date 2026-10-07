import type { SVGProps } from "react";

/** The bex brand mark, drawn in `currentColor`. The face is a cutout, so it shows the backdrop. */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="258 165 537 690" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        d="M258 292A55 55 0 0 1 313 237H420A55 55 0 0 1 475 292V385H560A235 235 0 0 1 560 855H303A45 45 0 0 1 258 810ZM423 502A75 75 0 0 0 348 577V648A75 75 0 0 0 423 723H608A75 75 0 0 0 683 648V577A75 75 0 0 0 608 502ZM440 567A27 27 0 0 0 413 594V631A27 27 0 0 0 467 631V594A27 27 0 0 0 440 567ZM588 567A27 27 0 0 0 561 594V631A27 27 0 0 0 615 631V594A27 27 0 0 0 588 567Z"
        fill="currentColor"
      />
      <path
        d="M633 290H681V420H633ZM588 237A72 72 0 1 1 732 237A72 72 0 1 1 588 237Z"
        fill="currentColor"
      />
    </svg>
  );
}
