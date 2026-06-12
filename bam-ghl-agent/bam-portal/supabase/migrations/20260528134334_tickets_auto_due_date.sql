-- Auto-calc due_date on ticket insert from priority + submitted_at.
-- urgent / red_alert → +1 business day; everything else → +5 business
-- days. Existing rows aren't touched (this is a BEFORE INSERT trigger).

CREATE OR REPLACE FUNCTION add_business_days(start_date date, n int)
RETURNS date AS $$
DECLARE
  result date := start_date;
  added int := 0;
BEGIN
  WHILE added < n LOOP
    result := result + 1;
    IF EXTRACT(DOW FROM result) NOT IN (0, 6) THEN
      added := added + 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION tickets_set_due_date()
RETURNS trigger AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := add_business_days(
      COALESCE(NEW.submitted_at, NOW())::date,
      CASE WHEN NEW.priority IN ('urgent','red_alert') THEN 1 ELSE 5 END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_due_date_trg ON tickets;
CREATE TRIGGER tickets_set_due_date_trg
BEFORE INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION tickets_set_due_date();;
