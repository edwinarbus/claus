import { html } from '../html.js';

/** A tiny "thinking" loader: a 3×3 ring (empty centre) where a 3-block comet of
 *  Claus house colours (blue / red / yellow / green) travels clockwise. Each
 *  step only the leading block takes a new colour while the trailing two keep
 *  theirs, so it reads as a moving comet rather than flashing. Sizes: sm
 *  (reasoning), md (chat), lg (boot/sync). */
export function BlockSpinner({ size = 'sm', className = '' }) {
  const sizeClass = size === 'lg' ? 'block-spinner--lg'
    : size === 'md' ? 'block-spinner--md'
      : 'block-spinner--sm';
  const extra = className ? ` ${className}` : '';
  return html`
    <span class=${`block-spinner ${sizeClass}${extra}`} aria-hidden="true">
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
      <span class="block-spinner-pixel"></span>
    </span>`;
}
