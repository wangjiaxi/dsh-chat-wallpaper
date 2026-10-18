/**
 * Host half of `dsh-chat-wallpaper`.
 *
 * The feature is entirely a browser-side concern: a settings page that stores
 * the chosen image in `localStorage` and a stylesheet rule that paints it
 * behind the conversation column. Nothing is needed on the Host, so this
 * module only has to exist for the loader row to mount.
 */
export function apply() {}
