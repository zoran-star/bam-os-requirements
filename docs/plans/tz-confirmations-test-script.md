# Test script: trial confirmations in each academy's own timezone

**What we changed:** when a parent books a free trial, the confirmation text and email now
show the session time on that academy's clock. A San Jose parent booking a 5pm trial sees
"5:00 PM", not "8:00 PM". Toronto academies see exactly what they see today.

---

## Before you start (someone has to do these first)

| # | Setup | Who |
|---|---|---|
| 1 | Run the database update that adds the new "timezone reminder sent" stamp. Without it, the owner heads-up in steps 5-7 will not fire at all. | Developer |
| 2 | In the San Jose academy's portal Settings, set the time zone to **Pacific Time (Los Angeles)**. | You or the developer |
| 3 | In the BAM GTA academy's portal Settings, confirm the time zone is set to **Eastern Time (Toronto)**. | You |
| 4 | Have a test phone number handy that you can book a trial with, and make sure the San Jose owner's phone number in the portal is one **you** can read (swap it to yours for the test, then put it back). | You |

> If step 1 is skipped, steps 1-4 and 8-9 still work. Only the owner heads-up test (5-7) needs it.

---

## The test

### 1. Book a San Jose trial
Go to the San Jose free-trial booking page and book a slot for **later this week at 5:00 PM
Pacific**. Use your test phone number.

**You should see:** the booking confirmation on screen, with the time you picked.

---

### 2. Check the text that lands on the test phone
Wait for the "Your free trial is booked!" text (a few minutes at most).

**You should see:** a line that reads **`Date & Time: <day>, <month> <date> at 5:00 PM`**.
It must say **5:00 PM**. If it says 8:00 PM, stop - that is the bug we were fixing.

---

### 3. Check the email version
Open the confirmation email that went to the same booking.

**You should see:** the same **5:00 PM**, matching the text exactly. Not 8:00 PM, and not
two different times between the text and the email.

---

### 4. Tap the "Add to calendar" link in that email
Tap the Apple or Google calendar link.

**You should see:** the event lands at **5:00 PM Pacific** on your phone's calendar (if your
phone is on Toronto time it will correctly show 8:00 PM, because that is the same moment -
that is fine and expected). The important thing is that it is the **same moment** as the
trial slot, not three hours off.

---

### 5. Now the "no timezone set" safety net - blank out the timezone
Go back to the San Jose academy's portal Settings and **clear the time zone** (leave it
empty). Save.

**You should see:** the setting saves with an empty timezone.

---

### 6. Book a second San Jose trial (different test contact)
Book another 5:00 PM Pacific slot, with a different name and phone number.

**You should see two things:**
- **A.** The parent still gets their booking text. It goes out no matter what. The time on
  it will now read **8:00 PM** (Toronto fallback) - that is correct for this broken-setup
  test.
- **B.** A moment later (the parent's text always goes out first), the San Jose **owner's**
  phone gets one short text: *"Heads up: your academy's timezone is not set, so booking texts
  show Toronto time. Fix it in Settings > Time zone in your portal."*

> If **B** never arrives, check that the owner actually has a phone number saved in the
> portal. With no number on file there is nobody to text, and the system will keep trying on
> the next booking rather than going quiet for a day.

---

### 7. Book a third trial the same day - the alert must NOT repeat
Straight away, book one more San Jose trial with a third test contact.

**You should see:** the parent gets their booking text as normal, and the owner's phone gets
**nothing new**. Exactly **one** heads-up text total for the day, not two. If a second one
arrives, that is a fail.

Now go back into San Jose Settings and **put Pacific Time back**. Book one more trial.

**You should see:** the text says **5:00 PM** again, and the owner gets **no** heads-up.

---

### 8. The one that would embarrass us - BAM GTA must be untouched
Book a free trial on the BAM GTA booking page for a slot you know the Toronto time of, for
example **7:00 PM**.

**You should see:** the text and email both read **`Date & Time: <day>, <month> <date> at
7:00 PM`**. Exactly what GTA has always sent. If a GTA time shifts by even an hour, stop and
send it back.

---

### 9. The morning-of check-in fires at the right local hour
On the morning of a booked San Jose trial, watch the test phone from about **8:30am Pacific**
(11:30am Toronto time).

**You should see:** the "are we still good for today?" text arrive **after 9:00am Pacific** -
not at 6:00am Pacific. Then do the same watch for a GTA trial: its check-in should still land
after **9:00am Toronto** time.

---

### 10. Sanity sweep
Open the confirmation inbox in the portal and read the last few San Jose cards and the last
few GTA cards side by side.

**You should see:** every San Jose card quoting Pacific times, every GTA card quoting Eastern
times, and no card with a blank or missing "Date & Time" line.

---

## Fail signals - send it back if you see any of these

- A San Jose time that is 3 hours later than the slot the parent picked.
- A GTA time that moved at all from what GTA sends today.
- A "Date & Time:" line that is blank or missing.
- The text and the email disagreeing about the time.
- The owner heads-up arriving twice in the same day, or never arriving when the timezone
  is blank.
