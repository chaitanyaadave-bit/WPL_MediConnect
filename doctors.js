document.addEventListener("DOMContentLoaded", async function () {
  const grid = document.getElementById("doctorsGrid");
  const noResults = document.getElementById("noResults");
  const resultCount = document.getElementById("resultCount");
  const searchInput = document.getElementById("searchName");
  const specialtySelect = document.getElementById("filterSpecialty");
  const clearBtn = document.getElementById("clearFilters");

  let specialties, doctors;
  try {
    [specialties, doctors] = await Promise.all([mcGetSpecialties(), mcGetDoctors()]);
  } catch (e) {
    resultCount.textContent = "";
    mcShowLoadError(grid, e.message);
    return;
  }
  const data = { specialties, doctors };
  const specialtyMap = {};
  specialties.forEach(s => specialtyMap[s.id] = s);

  specialties.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    specialtySelect.appendChild(opt);
  });

  const params = new URLSearchParams(window.location.search);
  const preSpecialty = params.get("specialty");
  if (preSpecialty && specialtyMap[preSpecialty]) {
    specialtySelect.value = preSpecialty;
  }

  function initials(name) {
    return name.replace("Dr. ", "").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  }

  function render() {
    const nameQuery = searchInput.value.trim().toLowerCase();
    const specFilter = specialtySelect.value;

    const filtered = data.doctors.filter(d => {
      const matchesName = d.name.toLowerCase().includes(nameQuery);
      const matchesSpec = !specFilter || d.specialtyId === specFilter;
      return matchesName && matchesSpec;
    });

    resultCount.textContent = `${filtered.length} doctor${filtered.length === 1 ? "" : "s"} found`;

    if (filtered.length === 0) {
      grid.innerHTML = "";
      noResults.classList.remove("d-none");
      return;
    }
    noResults.classList.add("d-none");

    grid.innerHTML = filtered.map(d => {
      const spec = specialtyMap[d.specialtyId];
      return `
      <div class="col-md-6 col-lg-4">
        <div class="card h-100 shadow-sm">
          <div class="card-body d-flex flex-column">
            <div class="d-flex align-items-center gap-3 mb-3">
              ${d.photo
                ? `<img src="${mcEscape(d.photo)}" alt="${mcEscape(d.name)}" class="rounded-circle flex-shrink-0" style="width:3rem;height:3rem;object-fit:cover;">`
                : `<span class="d-flex align-items-center justify-content-center text-white rounded-circle fw-bold flex-shrink-0" style="width:3rem;height:3rem;">${initials(d.name)}</span>`}
              <div>
                <h3 class="h6 mb-1">${mcEscape(d.name)}</h3>
                <span class="pill-teal">${spec ? mcEscape(spec.name) : ""}</span>
              </div>
            </div>
            <p class="small text-muted mb-1"><i class="bi bi-briefcase me-2"></i>${d.experience} years experience</p>
            <p class="small text-muted mb-3"><i class="bi bi-calendar-week me-2"></i>Available ${d.days.join(", ")}</p>
            <button class="btn btn-teal btn-sm mt-auto" data-doctor-id="${d.id}">View profile &amp; book</button>
          </div>
        </div>
      </div>`;
    }).join("");

    grid.querySelectorAll("[data-doctor-id]").forEach(btn => {
      btn.addEventListener("click", () => openDoctorModal(btn.getAttribute("data-doctor-id")));
    });
  }

  searchInput.addEventListener("input", render);
  specialtySelect.addEventListener("change", render);
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    specialtySelect.value = "";
    render();
  });

  render();

  // Modal / booking
  const modalEl = document.getElementById("doctorModal");
  const modal = new bootstrap.Modal(modalEl);
  const bookingForm = document.getElementById("bookingForm");
  const loginPrompt = document.getElementById("loginPrompt");
  const bookingConfirmed = document.getElementById("bookingConfirmed");
  let activeDoctor = null;

  const todayStr = new Date().toISOString().split("T")[0];
  document.getElementById("apptDate").setAttribute("min", todayStr);

  async function openDoctorModal(doctorId) {
    const doctor = data.doctors.find(d => d.id === doctorId);
    if (!doctor) return;
    activeDoctor = doctor;
    const spec = specialtyMap[doctor.specialtyId];

    document.getElementById("modalDoctorName").textContent = doctor.name;
    const modalPhoto = document.getElementById("modalPhoto");
    if (modalPhoto) {
      if (doctor.photo) {
        modalPhoto.src = doctor.photo;
        modalPhoto.alt = doctor.name;
        modalPhoto.classList.remove("d-none");
      } else {
        modalPhoto.classList.add("d-none");
      }
    }
    document.getElementById("modalSpecialty").textContent = spec ? spec.name : "";
    document.getElementById("modalQualification").textContent = doctor.qualification;
    document.getElementById("modalExperience").textContent = doctor.experience + " years of experience";
    document.getElementById("modalDays").textContent = "Available " + doctor.days.join(", ");
    document.getElementById("modalAbout").textContent = doctor.about;

    bookingForm.reset();
    bookingForm.classList.remove("d-none");
    bookingConfirmed.classList.add("d-none");

    const user = await mcCurrentUser();
    if (user) {
      loginPrompt.classList.add("d-none");
      bookingForm.classList.remove("d-none");
    } else {
      loginPrompt.classList.remove("d-none");
      bookingForm.classList.add("d-none");
      document.getElementById("modalLoginLink").href = "login.html?redirect=doctors.html";
    }

    modal.show();
  }

  bookingForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!activeDoctor) return;
    const user = await mcCurrentUser();
    if (!user) { loginPrompt.classList.remove("d-none"); bookingForm.classList.add("d-none"); return; }

    const submitBtn = bookingForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const appt = await mcApi("/appointments", {
        method: "POST",
        body: {
          doctorId: activeDoctor.id,
          date: document.getElementById("apptDate").value,
          time: document.getElementById("apptTime").value,
          reason: document.getElementById("apptReason").value
        }
      });
      document.getElementById("apptRef").textContent = appt.ref;
      bookingForm.classList.add("d-none");
      bookingConfirmed.classList.remove("d-none");
    } catch (err) {
      if (err.status === 401) {
        _mcUserPromise = null;
        loginPrompt.classList.remove("d-none");
        bookingForm.classList.add("d-none");
      } else {
        mcToast(err.message, "error");
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
});
