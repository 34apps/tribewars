# Flames shop screens, round 2: net prices + VAT by country (headless WebKit, mocked /lobby/api)

Prices are NET; the VAT of the chosen country is added on top and shown before paying (all numbers come from the server). No self-service refund.

- shop-1440.png: desktop 1440x900, mode stripe_tax, Estonia 24%: net line, VAT line, bold total per pack; "Pay 3.72 EUR for 100 Flames"; fits without scrolling
- shop-outside-1440.png: country "Outside the EU": "no EU VAT", total = net
- shop-nocountry-1440.png / shop-nocountry-360.png: country unknown: "+ VAT" on every pack, Pay button disabled ("Choose your country to see the full price")
- shop-notax-1440.png / shop-notax-360.png: mode none (Stripe Tax off): "VAT: added at checkout", no picker, "Pay for 100 Flames"
- shop-360.png: phone 360 px wide, full page; shop-360-top.png: first screen 360x780
- shop-locked-1440.png: balance below zero (paid features locked; buying still possible)
- shop-dispute-1440.png: open bank dispute banner with "Settle account" (page scrolls ~30 px here because of the banner)
- shop-minor-360.png: under-18 account: monthly cap line and the parent tick box

History rows show the total paid, the "net + VAT (country)" line, and "Refunded" for support refunds.
