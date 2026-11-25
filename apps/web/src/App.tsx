import { NavLink, Route, Routes } from 'react-router-dom';
import Assistant from './pages/Assistant';
import InvoiceDetail from './pages/InvoiceDetail';
import InvoiceList from './pages/InvoiceList';

export default function App() {
  return (
    <>
      <header className="cabecera">
        <div className="cabecera-in">
          <NavLink to="/" className="marca">
            Facturas recibidas
          </NavLink>
          <nav>
            <NavLink to="/" end>
              Facturas
            </NavLink>
            <NavLink to="/asistente">Asistente</NavLink>
          </nav>
        </div>
      </header>
      <main className="contenedor">
        <Routes>
          <Route path="/" element={<InvoiceList />} />
          <Route path="/facturas/:id" element={<InvoiceDetail />} />
          <Route path="/asistente" element={<Assistant />} />
          <Route path="*" element={<p>Página no encontrada.</p>} />
        </Routes>
      </main>
    </>
  );
}
