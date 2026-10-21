/**
 * Season economics check — not a test.
 *
 * A management game where every club is insolvent by Christmas is a bug, not
 * difficulty. This prints a full season of income and costs for the starting
 * club so the balance can be tuned against a target: a mid-table club should
 * roughly break even, a promotion push should profit, a bad season should hurt.
 */
import { advanceWeek, createCareer } from "./career";
import { computeAttendance, gateReceipts, weeklyCosts } from "./economy";

for (const divisions of [5]) {
  let career = createCareer({ seed: 20260820, divisions });
  const startBalance = career.clubs[career.playerClubId].balance;
  let income = 0;
  let costs = 0;
  let attendanceTotal = 0;
  let homeGames = 0;

  let guard = 0;
  while (!career.seasonComplete && guard < 200) {
    const before = career.clubs[career.playerClubId];
    const next = advanceWeek(career);
    const after = next.clubs[career.playerClubId];
    const delta = after.balance - before.balance;
    if (delta >= 0) income += delta;
    else costs += -delta;
    if (after.lastAttendance && after.lastAttendance > 0) {
      attendanceTotal += after.lastAttendance;
      homeGames++;
    }
    career = next;
    guard++;
  }

  const endBalance = career.clubs[career.playerClubId].balance;
  const club = career.clubs[career.playerClubId];
  const avgAtt = homeGames ? Math.round(attendanceTotal / homeGames) : 0;

  console.log(`divisions=${divisions}  tier=${club.tier}`);
  console.log(`  start balance   £${startBalance.toLocaleString("en-GB")}`);
  console.log(`  end balance     £${endBalance.toLocaleString("en-GB")}`);
  console.log(`  net             £${(endBalance - startBalance).toLocaleString("en-GB")}`);
  console.log(`  income          £${income.toLocaleString("en-GB")}`);
  console.log(`  costs           £${costs.toLocaleString("en-GB")}`);
  console.log(`  home games      ${homeGames}, avg crowd ${avgAtt.toLocaleString("en-GB")}`);
  console.log(`  final position  ${career.clubPosition}`);
  console.log(
    `  weekly costs    £${weeklyCosts(club).toLocaleString("en-GB")}  weekly gate (avg) £${gateReceipts(avgAtt, club.ticketPrice).toLocaleString("en-GB")}`,
  );
  console.log(
    `  capacity        ${club.capacity.toLocaleString("en-GB")}  utilisation ${((avgAtt / club.capacity) * 100).toFixed(0)}%`,
  );
  console.log(
    `  attendance@1st  ${computeAttendance(club, 1, 20).toLocaleString("en-GB")}  @20th ${computeAttendance(club, 20, 20).toLocaleString("en-GB")}`,
  );
}
