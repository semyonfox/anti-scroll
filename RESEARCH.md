# Anti-scroll Extension Research

Checked on 2026-06-10.

## Store Landscape

- Chrome: "Doomscroll Blocker | Website Blocker" tracks scroll distance and YouTube Shorts views, then blocks after thresholds. It is open source: https://github.com/Zjjc123/doomscroll-blocker
- Chrome: "Stop Social Media Scrolling" hard-blocks scroll on selected social sites and advertises local avoided-attempt analytics.
- Chrome/Firefox/Edge: LeechBlock NG is the mature broad website-blocker pattern: block sets, schedules, time limits, lockdown, override, delay pages, custom messages, and local stats. Source: https://github.com/proginosko/LeechBlockNG
- Firefox: "No Doom Scrolling" disables infinite scrolling and asks whether to continue or leave.
- Firefox: "Anti-Doomscroll" prompts before marked sites and asks for an intended time allowance. Source: https://github.com/sehlceris/anti-doomscroll-extension
- Edge: FocusTube and Unhook-style extensions focus on short-form/video-feed distractions: Shorts, Reels, TikTok, recommendations, comments, and sidebars. FocusTube source: https://github.com/malekwael229/FocusTube
- Safari/WebKit: Scrolless is a paid Safari app that blocks feeds while keeping messages/search/profiles, adds feed cleaning, and delays loosening changes by 12 hours.
- Cross-engine/ad-blocker: no-doomscroll filter lists for Zen/uBlock hide feed and recommendation surfaces without a full extension. Source: https://github.com/ZenPrivacy/filter-lists/tree/master/no-doomscroll

## Patterns Worth Reusing

- Preserve intentional use. The strongest products block algorithmic feeds, recommendations, short-video loops, and entry points while leaving posts, profiles, search, messages, and settings usable.
- Prefer site-specific feed selectors over whole-domain blocking. Whole-page blocks are useful for custom domains and all-sites mode, but known platforms should be feed-aware.
- Add entry-point hiding. Hiding Shorts/Reels/feed nav buttons reduces accidental entry before a full block is needed.
- Use MutationObserver plus interval fallback for SPAs. Dynamic sites regularly replace feed containers after navigation.
- Keep all data local. Store settings and simple counters in browser storage; do not add remote services.
- Provide a snooze/override path. A short pause reduces the need to disable the extension entirely.
- Make selector maintenance explicit. Store-specific listings and filter lists change often; sources should be easy to update.

## Patterns Not Copied

- No proprietary store-package code was copied. Closed extensions were used only for feature comparison.
- No flashing or hostile warning screens. Some blockers use aggressive overlays; Anti Scroll should stay calm and utilitarian.
- No LeechBlock-sized rules engine for now. The project is intentionally small; full schedules, passwords, and regex rule sets would change the product shape.
- No delayed "12-hour rule" yet. It is a strong paid-Safari pattern, but it needs careful UI and recovery design.

## Source Code Reviewed

- Doomscroll Blocker: scroll-distance threshold, Shorts count threshold, custom blocked sites, local thresholds.
- Scroll Friction: progressive wheel resistance, per-host cumulative scroll, daily local reset, draggable overlay.
- Anti-Doomscroll: warning page, intended visit duration, temporary per-domain allowance.
- News Feed Eradicator: typed sitelist, region selectors, per-region hide/remove/dull behavior, optional injected replacement widget, dynamic content-script registration.
- no-doomscroll filters: compact cosmetic rules for YouTube, TikTok, Instagram, X, Reddit, Bluesky, LinkedIn, and Twitch.
- FocusTube: strict/warn/passive modes, short-form path redirects, entry-point hiding, local stats, focus/break timers.
- DoomScroll: simple per-site toggles and broad feed selectors.
- Control-Scroll: per-session Shorts and LinkedIn post limits.
- Antigram: Instagram Reels/Explore/Stories/Post controls and "For You" to "Following" redirect.
- Distraction Free for LinkedIn: CSS-first hiding, visibility-preserving layout, page title/favicon quieting, in-page master toggle.

## Fit For This Repo

- Keep the no-build, plain JavaScript structure.
- Extend preset coverage without enabling non-social work sites by default.
- Keep feed hiding narrow and fail-open.
- Expose the existing `pausedUntilByHost` setting in the popup.
- Improve selectors for entry points and sidebars where they are clearly scroll-loop surfaces.
