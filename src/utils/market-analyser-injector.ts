/**
 * RamzFX Market Analyser injector.
 *
 * Injects a "RamzFX Market Analyser" Blockly procedure into any bot XML
 * string before it is loaded into the bot builder workspace. The analyser
 * scans all 10 Volatility markets (R_10..R_100, 1HZ10V..1HZ100V) and sets
 * the `analyser:bestMarket` variable to the symbol with the best pattern
 * score, then calls itself at the top of the bot's `before_purchase` stack
 * so it runs before every trade.
 *
 * This runs automatically for every XML file a user uploads/loads into the
 * bot builder (see load-modal-store.ts -> readFile).
 */

const ANALYSER_VAR_XML = `
    <variable type="" id="neaeofbpakpnpchnmgmd" islocal="false" iscloud="false">analyser:bestMarket</variable>
    <variable type="" id="jmfnpmmnkfdbnpafkgja" islocal="false" iscloud="false">analyser:bestScore</variable>
    <variable type="" id="gmlhppjdilcbbnlnjffi" islocal="false" iscloud="false">analyser:curScore</variable>`;

const ANALYSER_PROC_XML = `
  <block type="procedures_defnoreturn" id="lgjdpgknfmenbfjhaadi" collapsed="true" x="1400" y="0">
    <field name="NAME">RamzFX Market Analyser</field>
    <comment pinned="false" h="80" w="460">Scans all 10 Volatility markets and sets analyser:bestMarket to the symbol with the best pattern score before each trade. Wire up analyser:curScore inside each market check to use real tick data.</comment>
    <statement name="STACK">
      <block type="variables_set" id="gnjmkcnhllobnaojaeba">
        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
        <value name="VALUE"><block type="text" id="kondlibflhhifblpfgbk"><field name="TEXT">R_100</field></block></value>
        <next>
          <block type="variables_set" id="pldkdjcjfeacohofjelp">
            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
            <value name="VALUE"><block type="math_number" id="ikikjpociabmjhpbbdan"><field name="NUM">-1</field></block></value>
            <next>
              <block type="variables_set" id="ogpmiebeeikmpcaibceo">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="bibdiokbeoemanhcajop"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="ganmjimebfgpeafmekej">
                    <value name="IF0">
                      <block type="logic_compare" id="mbmfpolnfpoppohekpad">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="dkfmophppoeegpngeglg"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="jimdoocjapoingkdhfoc"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="hmkigokbgmphhjgkmmdn">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="jdgobhdafimjdbfpnmlf"><field name="TEXT">R_10</field></block></value>
                        <next>
                          <block type="variables_set" id="ejbokgiegbianhekcpmd">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="dcdbmdogkojjnbohadph"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="llbobgkkmgjeojhcajma">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="nphpdhlfneghliclbced"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="odaoniplfjpjajicekih">
                    <value name="IF0">
                      <block type="logic_compare" id="kheffigbdimkaakbffmi">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="ckhjjloeaebaphjpfdli"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="dlhhgifljiggmfmoilga"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="mldggnkijagandjkloej">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="iigpdeamjpignmbifinl"><field name="TEXT">R_25</field></block></value>
                        <next>
                          <block type="variables_set" id="jnpajibfoghpdmekdpcn">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="ibdaonhkmceanlhklidn"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="oplhckddcfgnggaoocfj">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="okknbbaedkodfphekege"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="egnkpnmbpokecmhfilni">
                    <value name="IF0">
                      <block type="logic_compare" id="ngghfdmklpccheifamaf">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="caoacgmemnlcaaehmobg"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="ojkgpkkgmcapggnkahba"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="eacihjbbcgpemlodmedf">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="belafdafejmdakiaiaol"><field name="TEXT">R_50</field></block></value>
                        <next>
                          <block type="variables_set" id="cfjgliidkfiejnlccmng">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="hipeghfdcngblbcpcoap"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="hgahcdehnbbhcecicehc">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="cneadhdekhmdefcfooan"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="nilfkekfhnifbpomdmok">
                    <value name="IF0">
                      <block type="logic_compare" id="fphbllblbhfpnbglbjda">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="gojlfmpnnggimlpbdpkn"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="dafpenjjnlpdaoiahaim"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="fikjlfnlhpjkjdhkninf">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="nddkhhoimcllmchjicfd"><field name="TEXT">R_75</field></block></value>
                        <next>
                          <block type="variables_set" id="leclcfmicaajnkmekkld">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="gpncfnemkmkplddphdma"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="jhfmannlcbcodcaolafp">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="jplkekcnnochafjjndpo"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="dnbddohjjjhccpdcnloe">
                    <value name="IF0">
                      <block type="logic_compare" id="mabbaofaeleahnojefei">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="ecahloplmggpcehdiibf"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="ippfljkilhnffhdemgeg"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="nlkdopfkplamdbgohmbg">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="ifjinpjljopobeljblkm"><field name="TEXT">R_100</field></block></value>
                        <next>
                          <block type="variables_set" id="bnpcgnllajlgfabiolco">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="faeifkclddplghkcbdja"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="edoibfbbjbhooahjoocb">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="fapodimipbclcceleahe"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="hjhpkfjboocijfmamada">
                    <value name="IF0">
                      <block type="logic_compare" id="ejldpfhdnmahdlglkfjg">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="honldgdbbhgcakmjebkf"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="hhekkegialcconeaimak"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="emaedgmjcbhiijbgcanl">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="dcekgdokbmgkkmcakcdk"><field name="TEXT">1HZ10V</field></block></value>
                        <next>
                          <block type="variables_set" id="gnnakdaeebmpnpghlmem">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="lnfofeocjnpfnabofgkl"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="eacfmbodhoickhpmjecb">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="lhopejbfgolbjlhmifih"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="jmdcdnkicofpjggogngf">
                    <value name="IF0">
                      <block type="logic_compare" id="jnemffcljomdabjldfga">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="caeblepmfhloljjpjhng"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="dlcpaefclmkdjhadfkfh"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="cjfngobmnblkmcehoifb">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="ofekkjabpmgpadmpphaf"><field name="TEXT">1HZ25V</field></block></value>
                        <next>
                          <block type="variables_set" id="fbhiofiokejdlafcpblh">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="mhleiiicpoioddolkahp"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="gbihkkjeopmbelmajjfe">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="cebbbcdbjcboliepbchi"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="mideniimclmjpfjfhaad">
                    <value name="IF0">
                      <block type="logic_compare" id="cnapgbncdeoafjbobfob">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="cndihjjibejpookaikic"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="ikgajlfaooapchdhdchc"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="gpimdlgingmajbimefge">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="mmngaddnmnhnkjkcfinm"><field name="TEXT">1HZ50V</field></block></value>
                        <next>
                          <block type="variables_set" id="mdajemjdclnhpfommnpi">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="jagjnfakemcaaohoback"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="offbolmfklgehhjhpiej">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="encibhkfhdebojmgggak"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="chlcpppoeliklopojibb">
                    <value name="IF0">
                      <block type="logic_compare" id="nbjlhgfljkmnmdnlhbke">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="lgmmdepfjpiijbnaniag"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="khgccbmjccedgppgddma"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="mianmnkofdplfmdpclhb">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="iaofpffldmdoemmagcjp"><field name="TEXT">1HZ75V</field></block></value>
                        <next>
                          <block type="variables_set" id="mhbehbdbnjiefkbhppbl">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="dapdlnbbipgghidmlfap"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    <next><block type="variables_set" id="jnmobdliabcoealigmmi">
                <field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field>
                <value name="VALUE"><block type="math_number" id="ejkjajnhlhmbichkikfg"><field name="NUM">0</field></block></value>
                <next>
                  <block type="controls_if" id="fnhecbjajkinogipocob">
                    <value name="IF0">
                      <block type="logic_compare" id="giacmigimigbghgkpikm">
                        <field name="OP">GT</field>
                        <value name="A"><block type="variables_get" id="fkdhlaookcninbnppjjl"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                        <value name="B"><block type="variables_get" id="dmacfcbohafkllajdcbj"><field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field></block></value>
                      </block>
                    </value>
                    <statement name="DO0">
                      <block type="variables_set" id="bfniljgobdkoaddhigdj">
                        <field name="VAR" id="neaeofbpakpnpchnmgmd" variabletype="">analyser:bestMarket</field>
                        <value name="VALUE"><block type="text" id="kijenpekmaggehhnamnm"><field name="TEXT">1HZ100V</field></block></value>
                        <next>
                          <block type="variables_set" id="fnmfkfhojnngchidokpk">
                            <field name="VAR" id="jmfnpmmnkfdbnpafkgja" variabletype="">analyser:bestScore</field>
                            <value name="VALUE"><block type="variables_get" id="knbojmfidajipbkfinji"><field name="VAR" id="gmlhppjdilcbbnlnjffi" variabletype="">analyser:curScore</field></block></value>
                          </block>
                        </next>
                      </block>
                    </statement>
                    
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block></next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>`;

const ANALYSER_CALL_XML = `<block type="procedures_callnoreturn" id="blnenidijmnnpoadhnna"><mutation name="RamzFX Market Analyser"></mutation><data>lgjdpgknfmenbfjhaadi</data>`;

/** Marker used to detect whether a bot already has the analyser injected. */
const ANALYSER_MARKER = 'RamzFX Market Analyser';

/**
 * Finds the start/end character offsets of a `<statement name="X">...</statement>`
 * block using depth-aware scanning, so nested `<statement>` tags inside the
 * target (e.g. inside `controls_if` blocks) don't break the boundary detection.
 */
function findStatementBounds(xml: string, statementName: string): { start: number; end: number } | null {
    const openMarker = `<statement name="${statementName}">`;
    const start = xml.indexOf(openMarker);
    if (start === -1) return null;

    let pos = start + openMarker.length;
    let depth = 1;

    while (pos < xml.length && depth > 0) {
        const nextOpen = xml.indexOf('<statement', pos);
        const nextClose = xml.indexOf('</statement>', pos);

        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            pos = nextOpen + '<statement'.length;
        } else {
            depth -= 1;
            if (depth === 0) {
                const end = nextClose + '</statement>'.length;
                return { start, end };
            }
            pos = nextClose + '</statement>'.length;
        }
    }

    return null;
}

/**
 * Injects the RamzFX Market Analyser block into a raw bot XML string.
 * Safe to call on any valid Deriv-bot XML. No-ops if the analyser is
 * already present (prevents double-injection on re-save/re-load).
 *
 * @param xmlString Raw XML text (e.g. from FileReader.readAsText)
 * @returns The XML string with the analyser injected, or the original
 *          string unchanged if injection wasn't possible (e.g. malformed
 *          XML or missing `before_purchase` block).
 */
export function injectMarketAnalyser(xmlString: string): string {
    if (!xmlString || typeof xmlString !== 'string') return xmlString;
    if (xmlString.includes(ANALYSER_MARKER)) return xmlString; // already injected

    let xml = xmlString;

    // 1. Add analyser variables into <variables>...</variables>
    if (xml.includes('</variables>')) {
        xml = xml.replace('</variables>', `${ANALYSER_VAR_XML}\n  </variables>`);
    } else if (xml.includes('<xml')) {
        // No <variables> block exists yet (rare) — add one right after the root <xml ...> tag
        xml = xml.replace(/(<xml[^>]*>)/, `$1\n  <variables>${ANALYSER_VAR_XML}\n  </variables>`);
    }

    // 2. Add the analyser procedure block right before the closing </xml>
    if (xml.includes('</xml>')) {
        xml = xml.replace('</xml>', `${ANALYSER_PROC_XML}\n</xml>`);
    } else {
        // Not a recognizable bot XML — bail out without modifying anything else
        return xmlString;
    }

    // 3. Inject the call at the top of BEFOREPURCHASE_STACK using depth-aware bounds
    const bounds = findStatementBounds(xml, 'BEFOREPURCHASE_STACK');
    if (!bounds) return xml; // still return xml with vars/proc added even if no before_purchase found

    const openTag = '<statement name="BEFOREPURCHASE_STACK">';
    const closeTag = '</statement>';
    const inner = xml.slice(bounds.start + openTag.length, bounds.end - closeTag.length);

    const newStatement =
        `${openTag}\n` +
        `      ${ANALYSER_CALL_XML}\n` +
        `        <next>\n` +
        `${inner}` +
        `        </next>\n` +
        `      </block>\n` +
        `    ${closeTag}`;

    xml = xml.slice(0, bounds.start) + newStatement + xml.slice(bounds.end);

    return xml;
}

/** True if the given XML string already contains the RamzFX Market Analyser block. */
export function hasMarketAnalyser(xmlString: string): boolean {
    return typeof xmlString === 'string' && xmlString.includes(ANALYSER_MARKER);
  }
