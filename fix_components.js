const fs = require('fs');

let code = fs.readFileSync('src/app/page.tsx', 'utf8');

// The return statement for `Home` usually starts like this:
// return (
//   <main className="...">
//     <div className="...">
//       ...

const returnMatch = code.match(/return \(\s*<main[\s\S]*?<\/main>\s*\);/);
if (returnMatch) {
   console.log("Matched perfect return block");
} else {
   console.log("Could not match perfect return block. Let's find exactly why.");
   let mainOpen = code.indexOf('<main');
   let mainClose = code.lastIndexOf('</main>');
   console.log(`<main> at ${mainOpen}, </main> at ${mainClose}`);
   
   let text = code.substring(mainOpen, mainClose + 7);
   
   let openDivs = (text.match(/<div/g) || []).length;
   let closeDivs = (text.match(/<\/div>/g) || []).length;
   console.log(`divs inside main: open=${openDivs} close=${closeDivs}`);
}
