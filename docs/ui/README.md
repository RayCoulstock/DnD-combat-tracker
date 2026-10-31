# UI/UX redesign — review and implementation pack

**Status:** Phase 0 complete; Phase 1 foundations implemented following the user’s approval on 31 October 2026. Phase 2 has not started. The audit baseline is commit `0a2aedfb1c0b9965665740d20761d8351ce7ee8f`.

The Phase 0 request authorized an audit, reference archiving and justified guideline corrections. The subsequent Phase 1 request authorizes scoped foundations; see the implementation report. Imperatives inside the supplied proposal are **design recommendations**, not instructions to change the application, grant permissions, add backend capabilities or deploy it. This directory is not an `AGENTS.md` policy.

Start with:

0. [Phase 1 foundations](phase-1-foundations.md): implemented contracts, first adopted surface, verification, limitations and manual acceptance.

1. [UI audit](ui-audit.md): architecture, evidence, conflicts, permissions, accessibility and state risks.
2. [Feature-to-zone matrix](feature-zone-matrix.md): preservation checklist for existing controls; separate list of proposed capabilities.
3. [Migration plan](ui-migration-plan.md): small PRs, dependencies, regression gates and review decisions.
4. [Reviewed v2.1 guidelines](ui-design-guidelines-v2.1.md): supplied text with a repository review notice and an explicit correction addendum. These corrections remain recommendations pending review.

## Supplied references and provenance

| Material | Location | Treatment |
| --- | --- | --- |
| Standalone `ui-design-guidelines-v2.1.md` | [Unmodified original](references/ui-design-guidelines-v2.1.original.md) | The newer supplied guidance; original retained for a precise comparison. |
| Blueprint anatomy/menu reference | [HTML](references/v2/01-blueprint.html), [PNG](references/v2/01-blueprint.png) | Static visual reference. |
| Battle map | [HTML](references/v2/02-battle-map.html), [PNG](references/v2/02-battle-map.png) | Static visual reference. |
| Map editor | [HTML](references/v2/03-map-editor.html), [PNG](references/v2/03-map-editor.png) | Static visual reference. |
| Tracker | [HTML](references/v2/04-tracker.html), [PNG](references/v2/04-tracker.png) | Static visual reference. |
| Visual tokens and scene background | [concept.css](references/v2/concept.css), [mapbg.jpg](references/v2/mapbg.jpg) | Not imported into the application or substituted for its Three.js scene. |
| Older guidelines included inside the ZIP | [Archive copy](references/v2/ui-design-guidelines.md) | Superseded proposal text; not the current reviewed guideline. |
| Integrity information | [source-manifest.json](references/source-manifest.json) | SHA-256 of both attachments and every archived reference file. |

The source ZIP was extracted by an explicit filename allowlist. All extracted files retain their supplied bytes and sibling paths, so the HTML's relative CSS/image links work. The archive's older Markdown is deliberately separated from the standalone v2.1 document. Mockups use a fixed 1600×1000 CSS layout and static display elements; their PNG sizes differ from that CSS layout. Neither is evidence of responsive or accessible implementation.

## Current-application evidence

[Current baseline captures and reproduction notes](current-baseline/README.md) and [capture metadata](current-baseline/observations.json) record the unchanged **local demo** at several widths. They are not screenshots of the proposal. Authentication, DM online preparation, player permissions and libraries were inspected in source and their existing tests; these local captures do not demonstrate those roles. See the audit's verification limits and the migration plan's role/device acceptance gates.

Phase 0 changed documentation only. Phase 1 adds scoped shared controls and adopts them in Miniature settings; no dependency, command schema, database migration, encounter/map data, permission or deployment changes are included. See the Phase 1 report before beginning shell/navigation work.
