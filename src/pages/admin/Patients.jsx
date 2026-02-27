import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function load() {
    const q = query(collection(db, "patients"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    setPatients(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  useEffect(() => {
    load();
  }, []);

async function addPatient(e) {
  e.preventDefault();

  if (!name.trim()) return;

  try {
    await addDoc(collection(db, "patients"), {
      name: name.trim(),
      phone: phone.trim(),
      createdAt: serverTimestamp(),
    });

    setName("");
    setPhone("");
    await load();
  } catch (err) {
    console.error("Add patient failed:", err);
    alert(err.message); // temporary: shows the exact reason
  }
}
  return (
    <div>
      <h3>Patients</h3>

    <form onSubmit={addPatient} className="form" style={{ maxWidth: 520 }}>
  <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
  <input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
  <button className="btn" type="submit">Add Patient</button>
    </form>

      <div style={{ marginTop: 16 }}>
        <h4>List</h4>
      <ul className="list">
  {patients.map(p => (
    <li className="item" key={p.id}>
      <div className="kv">
        <strong>{p.name}</strong>
        <span>{p.phone || "No phone"}</span>
      </div>
      <span className="badge">Patient</span>
     </li>
     ))}
     </ul>
      </div>
    </div>
  );
}