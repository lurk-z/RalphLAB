import "./comparisonEvidence.css";

export type ComparisonPhase =
  | "structures"
  | "interface"
  | "absorption"
  | "conclusion";

type Citation = { title: string; doi: string; url: string; locator: string };
type Metric = {
  id: string;
  label: string;
  unit: string;
  lispro: number;
  regular: number;
};
export type InsulinEvidence = {
  version: string;
  title: string;
  source: Citation;
  population: string;
  design: string;
  statistic: string;
  arms: { lispro: string; regular: string };
  metrics: Metric[];
  observation: string;
  hypothesis: string;
  mechanism_source: Citation;
  limitation: string;
};

type Atom = { chain: string; number: number; name: string; atom: string };
type Distance = { left: Atom; right: Atom; distance_angstrom: number };
type Structure = {
  pdb: string;
  title: string;
  source_url: string;
  paper_url: string;
  resolution_angstrom: number;
  contacts: Distance[];
  site_distances: Distance[];
};
export type ComparisonReport = {
  version: string;
  structures: Structure[];
  contact_rule: string;
  interface_note: string;
  alignment: {
    reference_pdb: string;
    mobile_pdb: string;
    method: string;
    atom_count: number;
    rmsd_angstrom: number;
  };
  evidence: InsulinEvidence;
};

function SourceLink({ source }: { source: Citation }) {
  return (
    <p className="ce-source">
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.title}
      </a>
      <span>{source.locator}</span>
    </p>
  );
}

function MoleculeKey({ contacts = false }: { contacts?: boolean }) {
  return (
    <ul className="ce-legend" aria-label="สีของโมเดลบนโต๊ะ">
      <li>
        <i className="ce-swatch ce-ab" />
        สาย A + B · โมเลกุลที่ 1
      </li>
      <li>
        <i className="ce-swatch ce-cd" />
        สาย C + D · โมเลกุลที่ 2
      </li>
      {contacts && (
        <li>
          <i className="ce-swatch ce-contact" />
          จุดที่ใช้วัดระยะ
        </li>
      )}
    </ul>
  );
}

function Structures({ report }: { report: ComparisonReport }) {
  const { alignment } = report;
  return (
    <>
      <h4>โครงสร้างผลึกที่นำมาเทียบ</h4>
      <div className="ce-models">
        {report.structures.map((s) => (
          <div key={s.pdb}>
            <strong>
              {s.pdb === "1LPH" ? "อินซูลิน lispro" : "อินซูลินมนุษย์ชนิดปกติ"}
            </strong>
            <p>
              <a href={s.source_url} target="_blank" rel="noreferrer">
                PDB {s.pdb}
              </a>
              {" · "}
              ความละเอียด {s.resolution_angstrom.toFixed(2)} Å
            </p>
          </div>
        ))}
      </div>
      <MoleculeKey />
      <p>
        ใช้ตำแหน่ง Cα ที่ตรงกัน {alignment.atom_count}{" "}
        ตำแหน่งเพื่อจัดแนวโมเลกุลทั้งสองคู่
        {" · "}RMSD {alignment.rmsd_angstrom.toFixed(3)} Å
      </p>
    </>
  );
}

function Interface({ report }: { report: ComparisonReport }) {
  return (
    <>
      <h4>ผิวสัมผัสระหว่างโมเลกุล</h4>
      <MoleculeKey contacts />
      <p>{report.contact_rule}</p>
      <div className="ce-models">
        {report.structures.map((s) => {
          const pair = s.site_distances[0];
          return (
            <div key={s.pdb}>
              <strong>
                <a href={s.source_url} target="_blank" rel="noreferrer">
                  {s.pdb}
                </a>
                {" · "}
                {s.contacts.length} คู่ที่เข้าเกณฑ์
              </strong>
              {pair && (
                <p className="ce-distance">
                  {pair.left.name} {pair.left.chain}
                  {pair.left.number} ↔ {pair.right.name} {pair.right.chain}
                  {pair.right.number}
                  <span>
                    {pair.left.atom} ↔ {pair.right.atom} ·{" "}
                    {pair.distance_angstrom.toFixed(2)} Å
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p>{report.interface_note}</p>
      <p className="ce-note">
        จำนวนคู่ที่พบขึ้นกับเกณฑ์ระยะและความครบถ้วนของพิกัดอะตอมในผลึกแต่ละชุด
      </p>
    </>
  );
}

function MetricChart({
  metric,
  arms,
}: {
  metric: Metric;
  arms: InsulinEvidence["arms"];
}) {
  const largest = Math.max(metric.lispro, metric.regular);
  const tick = 10 ** Math.floor(Math.log10(largest)) / 2;
  const maximum = Math.ceil(largest / tick) * tick;
  return (
    <figure className="ce-chart">
      <figcaption>{metric.label}</figcaption>
      <ul>
        {(["lispro", "regular"] as const).map((arm) => (
          <li key={arm}>
            <span>{arms[arm]}</span>
            <strong>
              {metric[arm]} {metric.unit}
            </strong>
            <div className="ce-track" aria-hidden="true">
              <i
                data-arm={arm}
                style={{ width: `${(metric[arm] / maximum) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="ce-axis" aria-hidden="true">
        <span>0</span>
        <span>
          {maximum} {metric.unit}
        </span>
      </div>
    </figure>
  );
}

function Absorption({ evidence }: { evidence: InsulinEvidence }) {
  return (
    <>
      <h4>{evidence.title}</h4>
      <p>
        {evidence.population} · {evidence.design}
      </p>
      <div className="ce-charts">
        {evidence.metrics.map((m) => (
          <MetricChart key={m.id} metric={m} arms={evidence.arms} />
        ))}
      </div>
      <p className="ce-note">{evidence.statistic}</p>
      <SourceLink source={evidence.source} />
    </>
  );
}

export function ComparisonEvidence({
  report,
  phase,
}: {
  report: ComparisonReport;
  phase: ComparisonPhase;
}) {
  const evidence = report.evidence;
  return (
    <section
      className="comparison-evidence"
      aria-label="หลักฐานเปรียบเทียบอินซูลิน"
    >
      {phase === "structures" && <Structures report={report} />}
      {phase === "interface" && <Interface report={report} />}
      {phase === "absorption" && <Absorption evidence={evidence} />}
      {phase === "conclusion" && (
        <>
          <h4>ข้อสรุปจากหลักฐาน</h4>
          <dl className="ce-findings">
            <div>
              <dt>ผลจากพิกัดโครงสร้าง</dt>
              <dd>
                ระยะสั้นที่สุดระหว่างอะตอมหนักที่ B28 กับ D23 ในแต่ละผลึก ·{" "}
                {report.structures.map(
                  (s) =>
                    s.site_distances[0] && (
                      <span key={s.pdb}>
                        {" "}
                        <a href={s.source_url} target="_blank" rel="noreferrer">
                          {s.pdb}
                        </a>{" "}
                        {s.site_distances[0].distance_angstrom.toFixed(2)}{" "}
                        Å{" "}
                      </span>
                    ),
                )}
              </dd>
            </div>
            <div>
              <dt>ผลที่วัดในคน</dt>
              <dd>
                {evidence.observation}{" "}
                <a href={evidence.source.url} target="_blank" rel="noreferrer">
                  อ่านการทดลอง
                </a>
              </dd>
            </div>
            <div>
              <dt>สมมติฐานกลไก</dt>
              <dd>
                {evidence.hypothesis}{" "}
                <a
                  href={evidence.mechanism_source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  อ่านงานโครงสร้าง
                </a>
              </dd>
            </div>
            <div>
              <dt>ขอบเขตของข้อสรุป</dt>
              <dd>{evidence.limitation}</dd>
            </div>
          </dl>
          <details>
            <summary>ดูโครงสร้างและระยะระหว่างโมเลกุล</summary>
            <Structures report={report} />
            <Interface report={report} />
          </details>
          <details>
            <summary>ดูกราฟผลในคนและต้นฉบับ</summary>
            <Absorption evidence={evidence} />
          </details>
        </>
      )}
    </section>
  );
}

export default ComparisonEvidence;
