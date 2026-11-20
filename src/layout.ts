/**
 * One pane at a time: phones, and phones turned sideways. The same breakpoint is written out in
 * styles/18-layout.css (media queries cannot read a variable); change both together.
 */
export const PHONE_LAYOUT =
  '(max-width: 800px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)';

export const isPhoneLayout = () => matchMedia(PHONE_LAYOUT).matches;
