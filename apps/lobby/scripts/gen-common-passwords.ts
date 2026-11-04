// Prints the built-in common-password list, one per line (to inspect it or to save it as a plain text file).
import { builtinCommonPasswords } from '../src/common-passwords.ts';

console.log(builtinCommonPasswords().join('\n'));
