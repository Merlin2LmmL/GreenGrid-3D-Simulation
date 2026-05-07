# TODO List – Energy Trading Simulation

## Energy Production & Consumption
- [ ] Increase solar energy generation rates so solar homes consistently produce more electricity than they consume during sunny periods.
- [ ] Rebalance generation values so normal households can generate significantly more than just ~2× their consumption.
- [ ] Adjust household consumption profiles to be more realistic:
  - [ ] Lower consumption during nighttime.
  - [ ] Higher usage during morning/evening peaks.

---

## Battery System
- [ ] Fix battery charging logic — batteries are currently not filling up correctly.
- [ ] Only assign batteries to ~70% of homes with solar panels.
- [ ] Ensure homes prioritize their own battery reserves before selling energy.
- [ ] Implement “survive until morning” battery reserve logic:
  - [ ] Sellers may trade battery energy at night only if enough reserve remains for their own expected overnight consumption.

---

## Trading & Market Logic
- [ ] Houses with insufficient energy should automatically create buy orders.
- [ ] While a buy order is still unmatched:
  - [ ] The house temporarily uses grid electricity.
- [ ] Seller conditions:
  - [ ] Sell when current production exceeds consumption.
  - [ ] OR when battery reserves exceed required self-consumption needs.
- [ ] Prevent instant trades:
  - [ ] Electricity should transfer continuously over time.
  - [ ] Transfer duration should depend on energy amount.
  - [ ] Example: trade continues until agreed Watt-hours are delivered.
- [ ] Verify and standardize trade units:
  - [ ] Use Watt-hours (Wh) for trade amounts.
  - [ ] Optionally use kilowatt-hours (kWh) for UI readability.

---

## Orders & Trade Visualization
- [ ] Display all ongoing trades on the dashboard.
- [ ] Mark houses with active/unfulfilled buy orders on house labels.
- [ ] Mark houses with active/unfulfilled sell orders on house labels.
- [ ] Show trade progress/status in real time.

---

## UI / Naming Improvements
- [ ] Rename “Delta €” variable:
  - [ ] Replace with a clearer term such as:
    - Net Profit €
    - Energy Balance €
    - Trading Profit €
    - Cumulative Earnings €
    - Net Earnings €

---

## Simulation Logic Refinements
- [ ] Ensure trading behaves continuously instead of instantaneously.
- [ ] Add realistic prioritization behavior:
  - [ ] Self-sufficiency first.
  - [ ] Grid fallback second.
  - [ ] Peer-to-peer selling only from true surplus energy.
- [ ] Validate all energy flow calculations:
  - [ ] Production
  - [ ] Consumption
  - [ ] Battery charging/discharging
  - [ ] Trade transfers
  - [ ] Grid usage

---

## Optional Enhancements
- [ ] Add estimated sunrise/sunset logic for better battery reserve decisions.
- [ ] Add live energy flow indicators between houses.
- [ ] Add trade history logs.
- [ ] Add grid usage statistics and costs.