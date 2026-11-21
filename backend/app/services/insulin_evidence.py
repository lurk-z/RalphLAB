"""Published human pharmacokinetic endpoints used by the insulin comparison case."""

# The published comparison is arm A against arm C. The zinc-containing lispro
# and intravenous regular insulin arms are different experimental conditions.
INSULIN_EVIDENCE = {
    "version": "howey-1994-ac-v1",
    "title": "ระดับอินซูลินในซีรัมหลังฉีดใต้ผิวหนัง",
    "source": {
        "title": "Howey และคณะ (1994) · Diabetes 43, 396–402",
        "url": "https://pubmed.ncbi.nlm.nih.gov/8314011/#abstract",
        "doi": "10.2337/diab.43.3.396",
        "locator": "บทคัดย่อ ผลเปรียบเทียบการทดลอง A กับ C ในย่อหน้าที่รายงาน Cmax และ Tmax",
    },
    "population": "ชายสุขภาพดีที่ไม่มีโรคเบาหวาน 10 คน",
    "design": "ผู้เข้าร่วมแต่ละคนได้รับทั้งสองสูตรในคนละครั้ง ขนาดครั้งละ 10 ยูนิตใต้ผิวหนัง "
              "ทีมวิจัยควบคุมระดับกลูโคสและวัดอินซูลินในซีรัม",
    "arms": {
        "lispro": "Lispro สูตรไม่มีสังกะสี (A)",
        "regular": "อินซูลินมนุษย์ชนิดปกติ (C)",
    },
    "statistic": "ตัวเลขสรุปของแต่ละสูตรตามบทคัดย่อ ผู้วิจัยไม่ได้ระบุชนิดของค่าสรุป "
                 "หรือรายงานค่าความแปรปรวนของสองตัวชี้วัดนี้ในบทคัดย่อ",
    "metrics": [
        {
            "id": "tmax",
            "label": "เวลาถึงความเข้มข้นสูงสุดในซีรัม (Tmax)",
            "unit": "นาที",
            "lispro": 42,
            "regular": 101,
        },
        {
            "id": "cmax",
            "label": "ความเข้มข้นสูงสุดในซีรัม (Cmax)",
            "unit": "pmol/L",
            "lispro": 698,
            "regular": 308,
        },
    ],
    "observation": "ในการทดลองนี้ ระดับอินซูลินในซีรัมของ lispro สูตรไม่มีสังกะสีขึ้นถึงจุดสูงสุด"
                   "เร็วกว่าอินซูลินชนิดปกติ 59 นาที และมีความเข้มข้นสูงสุดมากกว่า",
    "hypothesis": "ความต่างที่ผิวสัมผัสระหว่างโมเลกุลอาจทำให้ lispro แยกจากกลุ่มได้ง่ายขึ้น "
                  "และอาจมีส่วนให้ดูดซึมเร็วขึ้น",
    "mechanism_source": {
        "title": "Ciszak และคณะ (1995) · Structure 3, 615–622",
        "url": "https://pubmed.ncbi.nlm.nih.gov/8590022/",
        "doi": "10.1016/S0969-2126(01)00195-2",
        "locator": "บทคัดย่อ ส่วนการจับกลุ่มของอินซูลินและสมมติฐานการแยกตัวของโมเลกุล",
    },
    "limitation": "ผลคนมาจากสูตรและประชากรที่ระบุ ส่วน 1LPH เป็นผลึกที่มีสังกะสีและสารกลุ่มฟีนอล "
                  "การยืนยันว่าจุดสัมผัสใดเป็นสาเหตุของความต่างในคนต้องมีข้อมูลการแยกตัวในสารละลายเพิ่มเติม",
}
