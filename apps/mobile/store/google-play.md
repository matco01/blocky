# Google Play launch

Everything the Play Console asks for, ready to paste, and the order to do it in.
Google's rules change; check each policy link at submission time.

## Steps

1. **Developer account** at play.google.com/console: $25 once, plus ID verification.
   A *personal* account must run a **closed test with at least 12 testers for 14 days
   in a row** before it can publish to everyone. An *organization* account (needs a
   company and a D-U-N-S number) skips that. Start the closed test early: it's the
   longest wait.
2. **Create the app**: name "Blocky", default language English, App, Free.
3. **Build and upload**
   ```sh
   cd apps/mobile
   eas build --platform android --profile production   # signed .aab, versionCode bumped
   eas submit --platform android --profile production  # to the internal track, as a draft
   ```
   Google needs the very first upload done by hand in the Console. After that, `eas submit`
   needs a Google service account key (Console → Setup → API access), uploaded to EAS once
   with `eas credentials`.
4. **Fill in the App content pages** using the answers below.
5. **Testing**: internal track for you, then a closed track with the 12+ testers
   (waitlist people with Android phones). Testers join with a link from the Console.
6. **Production**: apply once the closed test has run 14 days.

## App access (for Google's reviewers)

Reviewers can't receive a sign-in code by email. Turn on **test accounts** in the Privy
dashboard to get a fixed email and code, and give those here with these instructions:

> Sign in with the email and code above. The wallet is on Arc testnet with test
> money, so nothing real moves. Ask "what's my balance?", then "send $1 to
> 0x…" (an address of yours). Every payment
> asks for the phone's fingerprint or PIN before anything is sent.

Fund that wallet with test USDC first. Point the reviewer build at testnet, or say
plainly that it's mainnet with a few real dollars.

## Store listing

**App name** (30 max)
> Blocky – Money in one chat

**Short description** (80 max)
> Send, save and invest by just asking. Your money, always in your own hands.

**Full description** (4000 max)
> Blocky puts all your money in one chat. Tell it what you want — "send Sam $20",
> "put $50 aside for the trip", "buy $20 of Apple" — and it lays out exactly what
> will happen: the amount, who gets it, every fee. Nothing moves until you approve
> it with your fingerprint.
>
> Your money stays yours. Blocky never holds your money or your keys. It sits in a
> wallet only you control, and you can take that wallet to another app at any time.
>
> Pay people by @username, split a bill, or send a request and get paid back. Set
> money aside in pots, set budgets, and get an alert when a price moves. Hold
> digital dollars (USDC), buy tokenized stocks and crypto, and move money between
> networks without learning how any of it works.
>
> Built to keep you safe. Blocky warns you before you send to a look-alike address,
> a new recipient or an unverified token, and you set the limits on what it can
> propose. The AI suggests; you decide.
>
> Blocky is non-custodial software, not a bank. Nothing in the app is financial
> advice. For people aged 18 and over.

**Graphics needed**
- App icon 512×512 PNG (from `assets/icon.png`).
- Feature graphic 1024×500 (a still from the promo film works).
- 2–8 phone screenshots: chat with a payment card, Home, Portfolio, a pot, Requests.

**Category**: Finance. **Contact email**: hello@blocky.page. **Website**: https://blocky.page.

## Privacy policy URL

https://blocky.page/privacy, but **that page only covers the website and waitlist**,
and says the app's policy is coming. It has to cover the app before you submit.
The facts are already on https://blocky.page/safety.

## Account deletion URL

https://blocky.page/delete-account. In the app: Account → Delete account.

## Data safety

Answers that match how the app works today (see blocky.page/safety).

- Does the app collect or share user data? **Yes**
- Is all data encrypted in transit? **Yes** (HTTPS only)
- Can users request deletion? **Yes** (in-app, and the URL above)

| Data type | Collected | Shared | Optional | Why |
|---|---|---|---|---|
| Personal info → Email address | Yes (Privy holds it) | No | No | Account management |
| Personal info → User IDs | Yes (Privy ID, @username) | No | No | Account management, app functionality |
| Financial info → Purchase history / Other financial info | Yes (payments you make, wallet address) | No | No | App functionality |
| Messages → Other in-app messages | Yes (chat sent to the AI; not stored by Blocky) | No | No | App functionality |
| App activity → Other user-generated content | Yes (contacts, pots, notes, request notes) | No | No | App functionality |

"Shared" is No because Privy, Anthropic, Railway and the price/route services act as
service providers on Blocky's behalf, which Google's definition doesn't count as
sharing. No ads, no analytics, no location, no device contacts, no photos.

## Other App content answers

- **Ads**: No.
- **Target audience**: 18 and over only.
- **Content rating**: questionnaire, Finance category. No violence, gambling or user-to-user chat.
- **Financial features declaration**: cryptocurrency wallet (**non-custodial**), plus
  peer-to-peer payments and buying digital assets. Play's policy on cryptocurrency
  exchanges and software wallets asks for licences mainly from *custodial* wallets and
  exchanges. Say clearly that Blocky never
  holds user funds or keys.
- **Government app / news / health**: No.
