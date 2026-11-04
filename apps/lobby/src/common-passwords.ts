import { readFileSync } from 'node:fs';

// The common-password list for the password policy: 10,000+ lowercase entries, built in memory at first use. No network.
//
// NOTE: this list is generated from well-known base passwords, names, keyboard walks and the usual suffixes (digits,
// years, "!"). It is NOT a copy of a published leak list. To add a published one (for example "10k-most-common"),
// point COMMON_PASSWORDS_FILE at a plain text file (one password per line): it is merged in at start-up.
// `npm run gen:passwords -w @clanfire/lobby` prints the built-in list.

const BASE = `password 123456 12345678 qwerty abc123 monkey letmein dragon 111111 baseball iloveyou trustno1 sunshine master welcome shadow ashley football jesus michael ninja mustang password1 admin login princess starwars solo freedom whatever qazwsx batman passw0rd zaq12wsx hello charlie donald secret superman hunter ranger buster thomas robert soccer hockey killer george andrew charles jordan harley jennifer daniel jessica hannah tigger pepper joshua matthew summer austin cheese amanda ginger yankees cookie maggie biteme badboy brandy chicken diamond london purple orange banana computer internet flower silver golden maverick phoenix falcon cowboy thunder corvette mercedes ferrari porsche camaro mickey snoopy peanut taylor nicole samantha jasmine lauren brittany melissa heather rachel chelsea rangers lakers knicks eagles giants steelers cowboys packers raiders yankee redsox dolphins jordan23 michelle sophie pookie buddy bailey rocket spider tiger lion wolf bear shark dolphin panda monster zombie vampire pirate wizard knight warrior viking soldier hammer sword dagger arrow castle kingdom empire legend hero champion winner victory power energy magic dream angel devil heaven hell paradise forever always never nothing everything someone anything welcome1 changeme default guest root toor test testing tester demo sample user username passwd pass pwd letmein1 trustme blahblah qwertyuiop asdfghjkl zxcvbnm asdfgh zxcvbn qwerty1 qwert 1qaz2wsx 1q2w3e4r 1q2w3e 1qazxsw2 qazwsxedc poiuytrewq mnbvcxz lkjhgfdsa iloveu loveyou lovely lover love1 loveme babygirl babyboy sweety sweetie honey darling kitten puppy kitty doggie bubbles fluffy muffin cupcake chocolate candy sugar cookies pancake waffle pizza burger coffee beer whiskey vodka tequila money dollar rich cash gold platinum bronze copper iron steel stone rock metal punk jazz music guitar piano drums violin singer dancer gamer gaming player games playstation xbox nintendo mario zelda pokemon minecraft fortnite roblox warcraft diablo skyrim halo doom quake clanfire tribewars tribal tribe clan village raid raider fire flame blaze inferno dark light shadows night midnight sunset sunrise rainbow ocean river mountain forest desert island planet galaxy universe cosmos star stars moon sun sky earth wind rain snow ice storm lightning turkey istanbul ankara izmir galatasaray fenerbahce besiktas trabzonspor admin123 administrator manager support service system server network access secure security private public master1 super hello123 welcome123 password123 abcd1234 abcdef abcdefg abcdefgh a1b2c3 a1b2c3d4 aaaaaa aaaaaaaa bbbbbb zzzzzz xxxxxx qqqqqq qweasd qweasdzxc asdasd asdqwe zxczxc mypass mypassword myname myself nobody anonymous unknown random simple easy hard strong weak secret1 secrets hidden mystery puzzle riddle question answer yes no maybe please thanks thankyou sorry hello1 hi hey bye goodbye good great awesome amazing cool super1 mega ultra hyper turbo nitro rocket1 racing speed fast quick flash lightning1 bolt jet plane train truck car bike motor engine driver pilot captain admiral general colonel major sergeant private1 agent spy secret2 ninja1 samurai shogun dragon1 phoenix1 unicorn pegasus griffin hydra titan atlas zeus apollo athena hermes poseidon hades ares thor odin loki freya valhalla asgard`.split(/\s+/);

const NAMES = `james john robert michael william david richard joseph thomas charles chris daniel matthew anthony mark donald steven paul andrew joshua kenneth kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel frank gregory raymond alexander patrick jack dennis jerry tyler aaron henry adam douglas nathan peter zachary kyle walter harold carl jeremy keith roger gerald ethan arthur terry christian sean lawrence joe noah jesse albert bryan billy bruce willie dylan alan ralph gabriel roy juan wayne eugene logan randy louis russell vincent philip bobby johnny bradley mary patricia linda elizabeth barbara susan sarah karen nancy lisa betty margaret sandra kimberly emily donna dorothy carol deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma helen katherine christine debra carolyn janet catherine maria diane ruth julie olivia joyce virginia victoria kelly christina joan evelyn judith megan andrea cheryl jacqueline martha gloria teresa ann sara madison frances kathryn janice jean abigail alice judy sophia grace denise amber doris marilyn danielle beverly isabella theresa diana natalie charlotte marie kayla alexis lori metin ahmet mehmet mustafa ali hasan huseyin ibrahim ismail yusuf murat emre burak can cem deniz ayse fatma emine hatice zeynep elif merve selin esra seda`.split(/\s+/);

const WORDS = `iloveyou1 princess1 sunshine1 football1 baseball1 superman1 starwars1 whatever1 dragon123 monkey123 master123 shadow123 hunter123 abc12345 qwerty123 qwerty12345 letmein123 trustno1 1234567890 0987654321 0123456789 9876543210 1234567891 123456789 12345678910 1111111111 0000000000 1212121212 1231231234 1357924680 2468013579 qwertyuiop1 asdfghjkl1 zxcvbnm123 1qaz2wsx3edc 1q2w3e4r5t 1q2w3e4r5t6y q1w2e3r4t5 q1w2e3r4t5y6 qazwsxedcrfv zaq1xsw2cde3 password12 password1234 password12345 passw0rd123 p@ssw0rd p@ssword p@ssw0rd1 pa55word pa55w0rd passpass passpass1 mypassword1 mypassword123 changeme123 admin1234 administrator1 iloveyou123 iloveyou2 ilovemyself ilovegod ilovecats ilovedogs lovelove loveyou2 loveyou123 forever21 forever1 mother123 father123 sister123 brother123 family123 friends123 friendship nothing123 secret123 secret1234 sunshine123 butterfly1 butterfly shadow12 chocolate1 blink182 linkinpark metallica nirvana beatles eminem madonna rihanna beyonce shakira justin123 bieber123 maria123 jordan123 jordan1234 michael123 michael1234 jessica123 ashley123 daniel123 thomas123 robert123 matthew123 andrew123 joshua123 charlie123 tigger123 pepper123 ginger123 cookie123 maggie123 buster123 hunter1234 soccer123 hockey123 killer123 rangers123 yankees123 cowboys123 football123 baseball123 basketball basketball1 skateboard volleyball swimming wrestling fishing hunting camping`.split(/\s+/);

const SUFFIXES = ['1', '2', '3', '7', '9', '11', '12', '13', '21', '22', '23', '69', '99', '00', '01', '10', '88', '123', '1234', '12345', '123456', '321', '007', '777', '666', '420', '!', '!!', '1!', '@', '#', '*', '.', '_1', '_123', '4life', 'abc', 'xyz'];

/** The built-in list (well over 10,000 entries), in rough order of popularity. Pure and deterministic. */
export function builtinCommonPasswords(): string[] {
  const out = new Set<string>();
  const add = (s: string): void => {
    const v = s.toLowerCase();
    if (v.length >= 1 && v.length <= 128) out.add(v);
  };
  for (const w of BASE) add(w);
  for (const w of WORDS) add(w);
  // Digit runs and keyboard walks.
  for (let n = 4; n <= 16; n++) {
    add('1234567890123456'.slice(0, n));
    add('0123456789012345'.slice(0, n));
    add('9876543210987654'.slice(0, n));
    for (const d of '0123456789') add(d.repeat(n));
  }
  for (const row of ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qazwsxedcrfvtgb', 'poiuytrewq', 'lkjhgfdsa', 'mnbvcxz', '1qaz2wsx3edc4rfv']) {
    for (let n = 5; n <= row.length; n++) add(row.slice(0, n));
  }
  // Words and names with the usual suffixes and years (most popular words first, so the cut-off drops the rarest).
  const seeds = [...BASE, ...NAMES];
  for (const sfx of SUFFIXES) for (const w of seeds) add(w + sfx);
  for (let y = 1970; y <= 2026; y++) for (const w of seeds.slice(0, 160)) add(w + String(y));
  // Doubled words and leet forms.
  for (const w of seeds.slice(0, 120)) {
    add(w + w);
    add(w.replace(/a/g, '@').replace(/o/g, '0').replace(/e/g, '3').replace(/i/g, '1'));
    add(w.replace(/o/g, '0').replace(/a/g, '4'));
  }
  return [...out];
}

let cached: Set<string> | null = null;

/** The set used by the password policy: the built-in list plus the optional extra file (read once). */
export function commonPasswords(extraFile = process.env.COMMON_PASSWORDS_FILE): Set<string> {
  if (cached) return cached;
  const set = new Set(builtinCommonPasswords());
  if (extraFile && extraFile.trim() !== '') {
    for (const line of readFileSync(extraFile.trim(), 'utf8').split(/\r?\n/)) {
      const v = line.trim().toLowerCase();
      if (v !== '') set.add(v);
    }
  }
  cached = set;
  return set;
}
