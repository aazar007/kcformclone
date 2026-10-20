/**
 * The default privacy notice, in the editable format.
 *
 * Held as text rather than JSX so the organisers can own it: the admin console
 * shows this in a textarea, they change what they need to, and the page renders
 * whatever they save. Before this, the notice was hard-coded JSX, which meant a
 * competition with different data practices had to edit source code.
 *
 * Format, deliberately minimal so it is obvious how to write:
 *
 *   ## Heading        starts a section
 *   Any other line    one paragraph
 *   {{tournament}}    replaced with the configured tournament name
 *   **bold**          bold
 *
 * An empty notice falls back to this text, so a fresh deployment still has a
 * factual notice rather than a blank page.
 */
export const DEFAULT_PRIVACY_NOTICE = `## What is collected
**About the team:** the team name, the division, the game entered, and the reference code issued on registration.
**About each member** (players, substitutes and coaches): full name, in-game tag, university, university email address, student ID, Discord username and mobile number. Coaches are not asked for a student ID or an in-game tag.
**Also:** any extra questions the organisers configured, the time of submission, and whether an entry has been edited since.
Every member's university email address must be confirmed with a one-time code before a registration is accepted. No passwords are collected or stored.

## Why it is collected
To run the tournament: checking eligibility, confirming that each person is an enrolled student, building the bracket, and contacting members about match schedules and lobby details. Contact details exist so that a match can be arranged — not for marketing.

## What is verified, and what is not
Email addresses are verified by a one-time code, which proves the address is reachable. Student IDs and names are **not** validated against any university record by this system; organisers check eligibility separately. Providing false information is grounds for disqualification.

## Who can see it
The organisers of {{tournament}}, through a password-protected console. What ends up on a public bracket is the team name, the game and division — not personal contact details.
The confirmation email goes to the team leader and lists the roster — each member's name, university, student ID, in-game tag and Discord username. It deliberately does **not** include members' email addresses or phone numbers.
Data is not sold, and is not shared with anyone else except where law requires it.

## Where it is held
In a PostgreSQL database hosted by a cloud provider, and in email messages sent through a mail provider. Both are third-party services acting on the organisers' instructions. Sign-in codes are stored only as a one-way hash, so the database does not contain usable codes.

## How long it is kept
For the duration of the tournament and a reasonable period afterwards for results, disputes and prize administration. After that it is deleted on request, or once it is no longer needed.

## Your choices
Ask the organisers to correct anything inaccurate, to send you a copy of what is held about you, or to delete it. Quote the team's reference code (it looks like KSU-26-XXXXXX) so the entry can be found.
A member who does not want their details stored can simply not take part; there is no way to enter a team without the member details above, because they are what eligibility is checked against.

## Consent
The person submitting a registration is asked to confirm they have read this notice and that every member listed knows their details are being shared. The time that confirmation was given is recorded alongside the registration.`;

/**
 * The Arabic notice.
 *
 * Held separately rather than translated on the fly, because a privacy notice is not
 * a user interface string — it is a statement the organisers may need to adjust for
 * their own circumstances, and they must be able to do that in each language without
 * one edit overwriting the other.
 */
export const DEFAULT_PRIVACY_NOTICE_AR = `## ما الذي يُجمع
**عن الفريق:** اسم الفريق، والقسم، واللعبة المشارك بها، ورقم التسجيل الصادر عند التسجيل.
**عن كل عضو** (اللاعبون والاحتياطيون والمدربون): الاسم الكامل، والمعرّف في اللعبة، والجامعة، والبريد الجامعي، والرقم الجامعي، ومعرّف ديسكورد، ورقم الجوال. ولا يُطلب من المدربين رقم جامعي أو معرّف في اللعبة.
**أيضًا:** أي أسئلة إضافية يحدّدها المنظّمون، ووقت الإرسال، وما إذا عُدّل التسجيل لاحقًا.
يجب تأكيد البريد الجامعي لكل عضو برمز يُرسل مرة واحدة قبل قبول التسجيل. ولا تُجمع كلمات المرور ولا تُخزَّن.

## لماذا يُجمع
لتنظيم البطولة: التحقق من الأهلية، والتأكد من أن كل شخص طالب مسجَّل، وبناء جدول المنافسات، والتواصل مع الأعضاء بشأن المواعيد وبيانات الغرف. وبيانات التواصل موجودة لترتيب المباريات — لا لأي تسويق.

## ما الذي يُتحقق منه وما لا يُتحقق منه
يُتحقق من عناوين البريد الإلكتروني برمز يُرسل مرة واحدة، وهو ما يثبت إمكانية الوصول إلى العنوان. أما الأرقام الجامعية والأسماء ف**لا** يتحقق منها هذا النظام مقابل أي سجل جامعي؛ بل يتحقق المنظّمون من الأهلية بشكل منفصل. وتقديم معلومات غير صحيحة سبب للاستبعاد.

## من يمكنه الاطلاع عليها
منظّمو {{tournament}} عبر لوحة محمية بكلمة مرور. وما يظهر في الجدول العام هو اسم الفريق واللعبة والقسم — لا بيانات التواصل الشخصية.
تُرسل رسالة التأكيد إلى قائد الفريق وتضمّ قائمة الأعضاء — اسم كل عضو وجامعته ورقمه الجامعي ومعرّفه في اللعبة وحساب ديسكورد. ولا تتضمن عن قصد عناوين البريد الإلكتروني أو أرقام الجوال للأعضاء.
ولا تُباع البيانات ولا تُشارك مع أي جهة أخرى إلا حيث يقتضي النظام.

## أين تُحفظ
في قاعدة بيانات PostgreSQL مستضافة لدى مزوّد سحابي، وفي رسائل بريد إلكتروني تُرسل عبر مزوّد بريد. وكلاهما خدمات طرف ثالث تعمل بتوجيهات المنظّمين. وتُخزَّن رموز الدخول كقيمة أحادية الاتجاه فقط، فلا تحتوي قاعدة البيانات على رموز صالحة للاستخدام.

## مدة الاحتفاظ بها
طوال مدة البطولة وفترة معقولة بعدها للنتائج والاعتراضات وتسليم الجوائز. وبعد ذلك تُحذف بناءً على الطلب، أو عند انتهاء الحاجة إليها.

## خياراتك
اطلب من المنظّمين تصحيح أي معلومة غير دقيقة، أو إرسال نسخة من البيانات المحفوظة عنك، أو حذفها. واذكر رقم تسجيل الفريق (يبدو بالشكل KSU-26-XXXXXX) لتسهيل العثور على التسجيل.
ومن لا يرغب في حفظ بياناته يمكنه ببساطة عدم المشاركة؛ فلا سبيل لتسجيل فريق دون بيانات الأعضاء المذكورة أعلاه، لأنها الأساس الذي تُفحص به الأهلية.

## الموافقة
يُطلب من الشخص الذي يرسل التسجيل تأكيد أنه قرأ هذا الإشعار وأن جميع الأعضاء المذكورين يعرفون أن بياناتهم ستُشارك. ويُسجَّل وقت إعطاء هذه الموافقة مع التسجيل.`;

/** Advisory shown to the organisers, not to entrants. */
export const PRIVACY_NOTICE_ADVICE =
  "This is a factual description of what the system stores. It is not legal advice — have it reviewed against your own obligations before relying on it.";
