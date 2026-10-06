-- Training Center course text: take out internal meeting notes and the old
-- "Command Center" name (EA terminology audit, 6 Oct 2026). Safe to run twice:
-- each replace is a no-op once the text is clean.

update academy_modules set summary =
  regexp_replace(regexp_replace(regexp_replace(summary,
    ' Reichelle: Day 1 is foundations\.', '', 'g'),
    ' Draft arrangement, pending Reichelle\.', '', 'g'),
    '([Tt])he Command Center', '\1he Hub', 'g')
where summary ~ 'Reichelle|Command Center';

update academy_lessons set
  title = regexp_replace(title, '([Tt])he Command Center', '\1he Hub', 'g'),
  body = regexp_replace(regexp_replace(body,
    ' \((Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+\)', '', 'g'),
    '([Tt])he Command Center', '\1he Hub', 'g')
where title ~ 'Command Center' or body ~ 'Command Center|\((Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+\)';

update academy_questions set
  prompt = regexp_replace(prompt, ' \((Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+\)', '', 'g'),
  explanation = regexp_replace(regexp_replace(explanation,
    ' \((Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+\)', '', 'g'),
    '^(Rowena|Reichelle) [0-9:]+\. ', '', 'g')
where prompt ~ '\((Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+\)'
   or explanation ~ '(Rowena|Reichelle|Laura|FJ|Prince|Bryan) [0-9:]+';
