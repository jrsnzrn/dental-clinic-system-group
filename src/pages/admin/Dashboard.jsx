import { Outlet } from "react-router-dom";

export default function Dashboard({ adminRole = "" }) {
  return <Outlet />;
}