# Historical National Assembly defection data

The demonstration uses sourced records of real party changes in Nigeria's 10th National Assembly, rather than invented names or randomly generated events. The intended scope is **13 June 2023 to 25 October 2026**, Senate and House of Representatives. Research was checked on **25 October 2026**.

**Coverage is partial:** the committed backfill contains **68 defection events for 59 members: 25 Senate events and 43 House events**. The earliest included event is 12 October 2023 and the latest is 13 October 2026. This is a researched starting dataset, **not an exhaustive register through October 2026**, a complete 469-seat roster, or proof that no other defections occurred. Late-2026 coverage is sparse, and several 2025/early-2026 waves still need systematic backfill.

The machine-readable file is [defections.historical.json](../supabase/seed/defections.historical.json). Each row identifies the member, chamber, state, constituency, election party, preceding/destination party, formal announcement date, a source URL/title/outlet, a short verbatim excerpt and research date. Real records must be imported with `is_fictional = false`. No agent inference or fictional quote is used as evidence.

## Date and identity conventions

- `event_date` is the date of the verified completed defection. For most rows it is the formal plenary announcement date. `announced_date` is populated only when a chamber announcement is established; it is omitted for independently verified receptions or completed party membership changes without a checked plenary announcement. It can follow the date of a party resignation or reception ceremony. For example, the [Kebbi senators' announcement](https://www.channelstv.com/2025/05/13/three-pdp-senators-defect-to-apc/) is dated 13 May 2025; [Kawu Sumaila's announcement](https://www.channelstv.com/2025/05/07/kano-nnpp-senator-joins-apc/) is dated 7 May.
- `published_at` uses the source's calendar date at `00:00:00Z` where an exact publication time is unavailable. This is a normalization convention, **not a claim that the source published at midnight**. Archived proceedings use their sitting date; their later upload date is not treated as the event date.
- `verified_at` means this research pass checked the cited source. It does not claim the launch checklist's independent two-person roster review has happened.
- The [official House inaugural proceedings](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Tuesday-13-June-2023.pdf) establish the baseline House party/constituency records. The [INEC senators-elect list](https://inecnigeria.org/wp-content/uploads/2023/03/LIST-OF-SENATORS-ELECT-FEB-2023.pdf) supports Senate election parties; the PDF currently appears in the search index but direct retrieval can fail. The [National Assembly Library Trust Fund Senate directory](https://naltf.gov.ng/senate-page/) provides another official identity reference. These are historical references, not a current party-strength census.
- Most included members' `term_start` is the 13 June 2023 inauguration. Salisu Yusuf Majigiri's start is **26 September 2023**, established by the [official oath record](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Tuesday-26-September-2023.pdf). Alfred Illiya Ajang's start is **21 November 2023**, supported by [the contemporary parliamentary report](https://parliamentreports.com/just-in-reps-swear-in-replacement-of-sacked-plateau-pdp-lawmakers/) and [his office's signed anniversary statement](https://viewpointnigeria.org/hon-alfred-iliya-ajang-member-representing-the-good-people-of-jos-east-jos-south-clocks-one-week/). Later court replacements are not silently assigned inaugural service.
- Names retain familiar reporting forms where unambiguous. “Etim Bassey” in the July 2025 report is normalized to **Aniekan Etim Bassey**, and “Ekong Samson” to **Ekong Sampson**, using official election/directory identity records. Different ordering/spelling in a source is not a separate member.
- Ifeanyi Ubah is included for his 2023 change but marked **deceased**, with `left_office_on = 2024-07-27`; [the contemporaneous death report](https://www.channelstv.com/2024/07/27/senator-ifeanyi-ubah-is-dead/) supports the departure. He must not contribute to current sitting-seat totals.
- Repeated changes remain separate chronological events: Rufai Sani Hanga NNPP → NDC → APC, Chinwe Clara Nnabuife YPP → APGA → APC, Garba Maidoki PDP → APC → ADC, Victor Umeh LP → ADC → NDC, Enyinnaya Abaribe APGA → ADC → LP, and four House members LP → ADC → NDC. Each member's first included origin matches their election party; intermediate changes are not collapsed.
- **NDC means Nigeria Democratic Congress**, as registered by [INEC](https://www.inecnigeria.org/parties/nigeria-democratic-congress). Some reporting expands the acronym incorrectly. **A means Accord**, per [INEC's party register](https://inecnigeria.org/parties).

## Event sources

Official Votes and Proceedings scans, printed by National Assembly Press and archived by PLAC, are preferred. For the remaining rows, the file identifies contemporaneous reports describing letters read on the chamber floor. Those reports are **fallback journalistic evidence**, not official parliamentary records. Every source below is linked on its individual event records as well.

| Verified event date | Included events | Source | Provenance |
|---|---:|---|---|
| 2023-10-12 | 1 | [Ifeanyi Ubah Dumps YPP, Joins APC](https://www.channelstv.com/2023/10/12/just-in-ifeanyi-ubah-dumps-ypp-joins-apc/) | Fallback: correspondent report of plenary |
| 2024-07-23 | 1 | [LP senator defects to APC](https://punchng.com/lp-senator-defects-to-apc/) | Fallback: correspondent report of plenary |
| 2024-10-02 | 1 | [House of Representatives Votes and Proceedings — 2 October 2024](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Wednesday-2-October-2024.pdf) | Primary: official chamber proceedings |
| 2024-10-30 | 1 | [House of Representatives Votes and Proceedings — 30 October 2024](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Wednesday-30-October-2024.pdf) | Primary: official chamber proceedings |
| 2024-12-05 | 5 | [Four Labour Party reps, Ibori’s daughter defect to APC](https://www.thecable.ng/four-labour-party-reps-iboris-daughter-defect-to-apc/) | Fallback: correspondent report of plenary |
| 2024-12-12 | 1 | [Another LP Reps Defects To APC, Cites Leadership Crisis](https://www.channelstv.com/2024/12/12/another-lp-reps-defects-to-apc-cites-leadership-crisis/) | Fallback: correspondent report of plenary |
| 2025-02-05 | 1 | [Senate Confirms Ned Nwoko’s Defection To APC](https://www.channelstv.com/2025/02/05/senate-confirms-ned-nwokos-defection-to-apc/) | Fallback: correspondent report of plenary |
| 2025-02-11 | 1 | [House of Representatives Votes and Proceedings — 11 February 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Tuesday-11-February-2025.pdf) | Primary: official chamber proceedings |
| 2025-02-12 | 1 | [House of Representatives Votes and Proceedings — 12 February 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Wednesday-12-February-2025.pdf) | Primary: official chamber proceedings |
| 2025-02-20 | 1 | [House of Representatives Votes and Proceedings — 20 February 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Thursday-20-February-2025.pdf) | Primary: official chamber proceedings |
| 2025-03-18 | 2 | [House of Representatives Votes and Proceedings — 18 March 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Tuesday-18-March-2025.pdf) | Primary: official chamber proceedings |
| 2025-03-27 | 1 | [House of Representatives Votes and Proceedings — 27 March 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-first-votes-and-proceedings-Thursday-27-March-2025.pdf) | Primary: official chamber proceedings |
| 2025-05-06 | 8 | [House of Representatives Votes and Proceedings — 6 May 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Tuesday-6-May-2025.pdf) | Primary: official chamber proceedings |
| 2025-05-07 | 1 | [Kano NNPP Senator Joins APC](https://www.channelstv.com/2025/05/07/kano-nnpp-senator-joins-apc/) | Fallback: correspondent report of plenary |
| 2025-05-08 | 3 | [House of Representatives Votes and Proceedings — 8 May 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-votes-and-proceedings-Thursday-8-May-2025.pdf) | Primary: official chamber proceedings |
| 2025-05-13 | 3 | [Three PDP Senators Defect To APC](https://www.channelstv.com/2025/05/13/three-pdp-senators-defect-to-apc/) | Fallback: correspondent report of plenary |
| 2025-05-15 | 3 | [House of Representatives Votes and Proceedings — 15 May 2025](https://placng.org/i/wp-content/uploads/2025/06/House-of-Reps-first-votes-and-proceedings-Thursday-15-May-2025.pdf) | Primary: official chamber proceedings |
| 2025-07-23 | 4 | [Four PDP Senators Defect To APC As Senate Majority Grows To 72](https://www.channelstv.com/2025/07/23/four-pdp-senators-defect-to-apc-as-senate-majority-grows-to-72/) | Fallback: correspondent report of plenary |
| 2026-03-11 | 5 | [Five federal lawmakers dump PDP, LP, join APC, Accord Party](https://www.premiumtimesng.com/news/top-news/863243-five-federal-lawmakers-dump-pdp-lp-join-apc-accord-party.html) | Fallback: correspondent report of plenary |
| 2026-03-12 | 4 | [12 Reps defect to APC, ADC](https://www.premiumtimesng.com/news/top-news/863691-12-reps-defect-to-apc-adc.html) | Fallback: correspondent report of plenary |
| 2026-03-12 | 8 | [Nine Senators Defect To ADC [FULL LIST]](https://www.channelstv.com/2026/03/12/nine-senators-defect-to-adc-full-list/) | Fallback: correspondent report of plenary |
| 2026-05-05 | 7 | [Abaribe Defects To Labour Party, Umeh And Rufai Hanga Join NDC](https://www.channelstv.com/2026/05/05/abaribe-defects-to-labour-party-umeh-and-rufai-hanga-join-ndc/) | Fallback: correspondent report of plenary |
| 2026-06-23 | 1 | [Senator disqualified from APC screening defects to ADC](https://www.premiumtimesng.com/news/more-news/890032-senator-disqualified-from-apc-screening-defects-to-adc.html) | Fallback: correspondent report of plenary |

| 2026-05-05 and 2026-09-05 | 2 | [Rufa’i Hanga, Kano’s only opposition senator, joins APC from NDC](https://www.thecable.ng/rufai-hanga-kanos-only-opposition-senator-joins-apc-from-ndc/) | Fallback: firsthand video of completed September reception; retrospective confirmation of May plenary |
| 2026-08-21 | 1 | [Kwara senator picks PDP senatorial ticket hours after dumping APC](https://punchng.com/kwara-senator-picks-pdp-senatorial-ticket-hours-after-dumping-apc/) | Fallback: video confirmation of PDP candidature after APC resignation |
| 2026-10-13 | 1 | [Ekwunife, others welcome Nnabuife into APC](https://punchng.com/ekwunife-others-welcome-nnabuife-into-apc/) | Fallback: correspondent report of plenary, published 14 October |

Short excerpts are deliberately limited to keep quotations from each source small, including sources shared by several members. Some snippets establish the announcement rather than repeating every structured detail: the linked document supplies the names, parties and constituencies. They are quotations from the reporting or proceedings, not necessarily direct words spoken by the member.

## State Houses of Assembly

[state-assembly.historical.json](../supabase/seed/state-assembly.historical.json) holds **85 researched defections by members of 19 state assemblies** (16 November 2023 to 29 August 2026; Kano 20, Rivers 16, Ogun 8 and others). It uses the same row format, except that `term_start` may be from 1 June 2023 because assemblies were inaugurated on different days. Coverage is partial in the same way as the federal file.

These records are **not published on import**. Without a sourced assembly roster, every state-assembly defection goes through review (SPEC §3.1), so `npm run seed:assemblies` drafts them into the review queue's *State-assembly backfill* section through the service-only `draft_historical_events`:

1. The import creates each event as `in_review` with its source, and stores the researched member details for the editor (never public).
2. The editor checks the source, adds the member (the form is pre-filled), then approves. The alert is dated to the event and does not appear as breaking news.
3. Rerun `npm run seed:assemblies` after approvals. It skips existing drafts, links a member's later events to the member just added (one member, Mohammed Garba Isimbabi, has two), and records departures: three members left office (two in Kwara, one in Delta) after their recorded defections.

A file must hold either federal or state-assembly rows: `seed:historical` refuses a mix, and sends state-assembly files to the review queue.

## Remaining verification and backfill

1. Systematically review both chambers' Votes and Proceedings from June 2023 through the research cutoff; the selected-source search performed here is not a completeness audit.
2. Backfill omitted waves, including further Kano, Akwa Ibom, Enugu, Rivers, Bayelsa and other changes during 2025–2026. Confirm individual identities, dates and entire party chains before import.
3. Exclude state assembly members, governors, former federal lawmakers and candidates who have not entered the current Assembly. A governor's mass-defection announcement without individual federal member names is insufficient for individual records.
4. Austin Akobundu and Amos Yohanna are intentionally absent pending checked court-replacement/service-start metadata. Unnamed or absent members whose notices had not yet been affirmed are not treated as completed events; the [12 March 2026 House report](https://www.premiumtimesng.com/news/top-news/863691-12-reps-defect-to-apc-adc.html) explicitly distinguishes such pending notices.
5. Hanga's August 2026 NDC resignation is not turned into an invented APC event: [TheCable's firsthand reception report](https://www.thecable.ng/rufai-hanga-kanos-only-opposition-senator-joins-apc-from-ndc/) establishes the completed APC move on **5 September 2026**. The intervening resignation is documented here because the affiliation model does not represent a temporary period with no party. Saliu Mustapha's **21 August 2026** completed PDP membership is supported by the video-confirmed party nomination following APC resignation; no plenary announcement date is claimed. Nnabuife's **13 October 2026** announcement is corroborated by [TVC's same-day report](https://www.tvcnews.tv/anambra-lawmaker-chinwe-nnabuife-dumps-apga-for-apc/) and [New Telegraph's same-day plenary report](https://newtelegraphng.com/ekwunife-leads-apc-delegation-as-nnabuife-dumps-apga-for-apc/). Punch's tag archive displays an inconsistent September date for that article; the actual article and independent same-day reporting support October.
6. Do not copy party-seat totals from articles. Some reports have internally inconsistent arithmetic, and this dataset contains only members with included defections. A complete, reviewed roster and departure history are necessary before the dashboard can describe full current chamber strength.
7. The importer must remain idempotent and refuse a party mismatch instead of overwriting an existing affiliation. Researcher corrections should be reviewed and applied through the reversal/review path when a record has already been published.


