const path = require("path");
const fs = require("fs");

const validator = require("validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/user");
const Post = require("../models/post");

module.exports = {
  createUser: async ({ userInput }, req) => {
    const errors = [];

    if (!validator.isEmail(userInput.email)) {
      errors.push({ message: "Email is invalid" });
    }
    if (
      validator.isEmpty(userInput.password) ||
      !validator.isLength(userInput.password, { min: 5 })
    ) {
      errors.push({ message: "Password is too short" });
    }
    if (errors.length > 0) {
      const error = new Error("Invalid input");
      error.statusCode = 422;
      error.data = errors;
      throw error;
    }
    const existingUser = await User.findOne({ email: userInput.email });
    if (existingUser) {
      const error = new Error("User existing already");
      throw error;
    }
    const hashedPw = await bcrypt.hash(userInput.password, 12);
    const newUser = new User({
      email: userInput.email,
      name: userInput.name,
      password: hashedPw,
    });

    const createdUser = await newUser.save();
    return { ...createdUser._doc, _id: createdUser._id.toString() };
  },
  createPost: async ({ postInput }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not authenticated!");
      error.statusCode = 403;
      throw error;
    }
    const errors = [];
    if (validator.isEmpty(postInput.title)) {
      errors.push({ message: "Title don't empty" });
    }
    if (validator.isEmpty(postInput.content)) {
      errors.push({ message: "Content don't empty" });
    }
    if (errors.length > 0) {
      const error = new Error("Invalid input");
      error.data = errors;
      error.statusCode = 422;
      throw error;
    }
    const user = await User.findById(req.userId);
    if (!user) {
      const error = new Error("User couldn't found.");
      error.statusCode = 404;
      throw error;
    }

    const post = new Post({
      title: postInput.title,
      imageUrl: postInput.imageUrl,
      content: postInput.content,
      creator: user,
    });
    const createdPost = await post.save();
    user.posts.push(createdPost);
    await user.save();
    return {
      ...createdPost._doc,
      _id: createdPost._id.toString(),
      createdAt: createdPost.createdAt.toISOString(),
      updatedAt: createdPost.updatedAt.toISOString(),
    };
  },
  login: async ({ email, password }) => {
    const user = await User.findOne({ email: email });
    if (!user) {
      const error = new Error("User don't existing");
      error.statusCode = 404;
      throw error;
    }
    const isEqual = await bcrypt.compare(password, user.password);
    if (!isEqual) {
      const error = new Error("Password is incorrect!");
      error.statusCode = 401;
      throw error;
    }
    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
      },
      "somesupersecretsecret",
      {
        expiresIn: "1h",
      }
    );
    return { token: token, userId: user._id.toString() };
  },
  updatedPost: async ({ id, postInput }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 403;
      throw error;
    }
    const errors = [];
    if (
      validator.isEmpty(postInput.title) ||
      validator.isLength(postInput.title, { min: 5 })
    ) {
      errors.push({ message: "Title is invalid." });
    }
    if (
      validator.isEmpty(postInput.content) ||
      validator.isLength(postInput.content, { min: 5 })
    ) {
      errors.push({ message: "Content is invalid." });
    }
    if (validator.isEmpty(postInput.imageUrl)) {
      errors.push({ message: "Image is invalid." });
    }
    if (errors.length > 0) {
      const error = new Error("Invalid input.");
      error.statusCode = 422;
      throw error;
    }

    try {
      const post = await Post.findById(id).populate("creator");
      if (!post) {
        const error = new Error("Post could not find.");
        error.statusCode = 404;
        throw error;
      }
      if (post.creator.toString() !== req.userId) {
        const error = new Error("Not Authenticated.");
        error.statusCode = 403;
        throw error;
      }

      post.title = postInput.title;
      post.content = postInput.content;
      if(postInput.imageUrl !==undefined){
        post.image = postInput.imageUrl;
      }
      const updatedPost = await post.save();
      return {
        ...updatedPost._doc,
        _id: updatedPost._id.toString(),
        createdAt: updatedPost.createdAt.toISOString(),
        updatedAt: updatedPost.updatedAt.toISOString(),
      };
    } catch (err) {
      if (!err.statusCode) {
        err.statusCode = 500;
      }
      next(err);
    }
  },
  posts: async ({ pages }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 401;
      throw error;
    }
    const perPages = 2;
    const totalPosts = await Post.find().countDocuments();
    const posts = await Post.find()
      .limit(perPages)
      .skip((pages - 1) * perPages)
      .populate("creator");

    const sendPosts = posts.map((p) => {
      return {
        ...p._doc,
        _id: p._id.toString(),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return { posts: sendPosts, totalPosts: totalPosts };
  },
  post: async ({ postId }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 401;
      throw error;
    }
    const post = await Post.findById(postId).populate("creator");
    return {
      ...post._doc,
      _id: post._id.toString(),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  },
  deletePost: async ({ postId }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 401;
      throw error;
    }
    const post = await Post.findById(postId).populate("creator");
    if (!post) {
      const error = new Error("Post could not find.");
      error.statusCode = 404;
      throw error;
    }
    if(post.creator._id.toString() !== req.userId.toString() ){
      const error = new Error('Not authorized.');
      error.statusCode = 403;
      throw error;
    }
    clearImage(post.imageUrl);
    await Post.findByIdAndRemove(postId);
    const user = await User.findById(req.userId);
    user.posts.pull(postId);
    await user.save();
    return  true;
  },
  user: async (args, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 401;
      throw error;
    }
    const user = await User.findById(req.userId);
    if (!user) {
      const error = new Error("User could not find.");
      error.statusCode = 404;
      throw error;
    }
    return {
      ...user._doc,
      _id: user._id.toString(),
    };
  },
  updateStatus: async ({ status }, req) => {
    if (!req.isAuth) {
      const error = new Error("Not Authenticated.");
      error.statusCode = 401;
      throw error;
    }
    const user = await User.findById(req.userId);
    if (!user) {
      const error = new Error("User could not find or existing");
      error.statusCode = 404;
      throw error;
    }
    user.status = status;
    const updatedUser = await user.save();
    return {
      ...updatedUser._doc,
      _id: updatedUser._id.toString()
    };
  },
};

const clearImage = (filePath) => {
  filePath = path.join(__dirname, "..", filePath);
  fs.unlink(filePath, (err) => console.log(err));
};
