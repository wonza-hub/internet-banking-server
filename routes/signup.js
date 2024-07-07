const express = require("express");
const sha256 = require("sha256");
const { sendEmail } = require("../utils/email");
const { checkId, verifyEmailCode } = require("../utils/validation");
const router = express.Router();
const axios = require("axios");
// 비밀번호 해싱 함수
const hashPassword = (password) => {
  return sha256(password);
};

// 중복 사용자 ID 체크
router.post("/check-id", async (req, res) => {
  const { client_id } = req.body;
  const mysqldb = req.app.get("mysqldb");

  try {
    const isAvailable = await checkId(mysqldb, client_id);
    if (!isAvailable) {
      return res.status(409).json({ message: "이미 사용 중인 아이디입니다." });
    }
    return res.status(200).json({ message: "사용 가능한 아이디입니다." });
  } catch (error) {
    return res.status(500).json({
      message: "서버 에러가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

// 이메일 인증 코드 발송
router.post("/send-verification-code", async (req, res) => {
  const { client_email } = req.body;
  const verificationCode = Math.floor(
    100000 + Math.random() * 900000
  ).toString();
  const subject = "이메일 인증 코드";
  const text = `인증 코드는 ${verificationCode} 입니다.`;

  try {
    await sendEmail(client_email, subject, text);
    req.session.verificationCode = verificationCode;
    return res
      .status(200)
      .json({ message: "입력하신 이메일로 인증코드가 전송되었습니다." });
  } catch (error) {
    return res.status(500).json({
      message: "인증코드 전송에 실패하였습니다. 다시 시도해주세요.",
      error: error.message,
    });
  }
});

// 이메일 인증 코드 확인
router.post("/verify-email-code", (req, res) => {
  const { verificationCode } = req.body;
  const sessionVerificationCode = req.session.verificationCode;

  if (verifyEmailCode(sessionVerificationCode, verificationCode)) {
    req.session.verificationCode = null; // 인증 코드 사용 후 무효화
    return res.status(200).json({ message: "이메일 인증이 완료되었습니다." });
  } else {
    return res.status(400).json({ message: "인증코드를 다시 확인해주세요." });
  }
});

// 캡챠 인증 결과 확인
router.post("/verify-captcha", async (req, res) => {
  const { token } = req.body;
  const recaptchaSecret = process.env.reCAPTCHA_SECRET_KEY;

  try {
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecret}&response=${token}`
    );
    const data = response.data;

    if (!data.success) {
      return res.status(400).json({
        message: "캡챠 인증에 실패하였습니다.",
        error: data["error-codes"],
      });
    }

    req.session.captchaVerified = true; // 캡챠 인증 성공 표시
    return res.status(200).json({ message: "캡챠 인증에 성공하였습니다." });
  } catch (error) {
    return res.status(500).json({
      message: "캡챠 인증 오류가 발생하였습니다.",
      error: error.message,
    });
  }
});

// 회원가입 처리
router.post("/", async (req, res) => {
  const {
    client_id,
    client_name,
    client_pw,
    client_email,
    client_phone,
    client_address,
    client_resi,
  } = req.body;

  // 이메일 인증 확인
  if (req.session.verificationCode) {
    return res
      .status(400)
      .json({ message: "이메일 인증이 완료되지 않았습니다." });
  }

  // 캡챠 인증 확인
  if (!req.session.captchaVerified) {
    return res
      .status(400)
      .json({ message: "캡챠 인증이 완료되지 않았습니다." });
  }

  // 비밀번호 해시
  const hashedPassword = hashPassword(client_pw);

  const mysqldb = req.app.get("mysqldb");

  // 주민등록번호와 전화번호 중복 체크 후, 단순 에러 메시지 반환
  try {
    // 중복 주민등록번호와 전화번호 체크
    const [rows] = await mysqldb
      .promise()
      .query(
        "SELECT client_resi, client_phone FROM Client WHERE client_resi = ? OR client_phone = ?",
        [client_resi, client_phone]
      );

    if (rows.length > 0) {
      return res.status(400).json({ message: "회원가입에 실패했습니다." });
    }

    // 새로운 사용자 정보 삽입
    await mysqldb.promise().query(
      `INSERT INTO Client (client_id, client_name, client_pw, client_email, client_phone, client_address, client_resi)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        client_id,
        client_name,
        hashedPassword,
        client_email,
        client_phone,
        client_address,
        client_resi,
      ]
    );

    // 이메일 인증 코드 초기화
    req.session.verificationCode = "";
    // 캡챴 인증 상태 초기화
    req.session.captchaVerified = false;

    return res.status(200).json({ message: "회원가입이 완료되었습니다." });
  } catch (error) {
    return res.status(500).json({
      message: "내부 서버 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

module.exports = router;
